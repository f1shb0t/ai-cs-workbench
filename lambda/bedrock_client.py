"""Bedrock Knowledge Base client."""

import os
import time
import logging
from typing import Any

import boto3

logger = logging.getLogger(__name__)

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")


def retrieve_chunks(
    question: str,
    kb_id: str,
    num_results: int = 5,
) -> list[dict]:
    """
    Call Bedrock Retrieve API to get raw chunks with confidence scores.
    Extracts Answer from metadata if available (KB stores Q&A pairs where
    content = question, metadata.Answer = the actual answer).

    Returns:
        [{"content": str, "question": str, "answer": str, "score": float, "uri": str, "metadata": dict}, ...]
    """
    if not kb_id:
        return []

    try:
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": question},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": num_results,
                }
            },
        )

        chunks = []
        for result in response.get("retrievalResults", []):
            content_obj = result.get("content", {})
            content_text = content_obj.get("text", "")
            score = result.get("score", 0.0)
            location = result.get("location", {})
            s3_loc = location.get("s3Location", {})
            uri = s3_loc.get("uri", "")
            metadata = result.get("metadata", {})

            # Extract Answer from metadata (KB stores Q in content, A in metadata)
            answer = metadata.get("Answer", "") or metadata.get("answer", "")

            chunks.append({
                "question": content_text,
                "answer": answer,
                "content": answer if answer else content_text,
                "score": float(score),
                "uri": uri,
                "metadata": metadata,
            })

        chunks.sort(key=lambda x: x["score"], reverse=True)
        return chunks

    except Exception as e:
        logger.error(f"Retrieve API failed: {e}")
        return []


def query_knowledge_base(
    question: str,
    kb_id: str | None = None,
    model_id: str | None = None,
    system_prompt: str | None = None,
) -> dict:
    """
    Query Bedrock Knowledge Base using RetrieveAndGenerate API,
    and also call Retrieve API for raw chunks.

    Returns:
        {
            "answer": str,
            "sources": [{"uri": str, "snippet": str}],
            "retrieved_chunks": [{"content": str, "score": float, "uri": str}],
            "latency_ms": int,
        }
    """
    kb_id = kb_id or os.environ.get("KNOWLEDGE_BASE_ID", "")
    model_id = model_id or os.environ.get("MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
    system_prompt = system_prompt or os.environ.get("SYSTEM_PROMPT", "")

    if not kb_id:
        logger.error("No Knowledge Base ID configured")
        return {
            "answer": "Knowledge Base not configured. Please set the KB ID in settings.",
            "sources": [],
            "retrieved_chunks": [],
            "latency_ms": 0,
        }

    # Build model ARN
    region = os.environ.get("AWS_REGION", "us-west-2")
    if model_id.startswith("global.") or model_id.startswith("us.") or model_id.startswith("eu."):
        # Cross-region inference profile: needs account ID
        sts = boto3.client("sts")
        account_id = sts.get_caller_identity()["Account"]
        model_arn = f"arn:aws:bedrock:{region}:{account_id}:inference-profile/{model_id}"
    else:
        # Standard foundation model
        model_arn = f"arn:aws:bedrock:{region}::foundation-model/{model_id}"

    start_time = time.time()

    try:
        # Step 1: Retrieve raw chunks (for display)
        retrieved_chunks = retrieve_chunks(question, kb_id, num_results=5)

        # Step 2: RetrieveAndGenerate for answer
        request_params: dict[str, Any] = {
            "input": {"text": question},
            "retrieveAndGenerateConfiguration": {
                "type": "KNOWLEDGE_BASE",
                "knowledgeBaseConfiguration": {
                    "knowledgeBaseId": kb_id,
                    "modelArn": model_arn,
                    "retrievalConfiguration": {
                        "vectorSearchConfiguration": {
                            "numberOfResults": 5,
                        }
                    },
                },
            },
        }

        # Add generation configuration with system prompt if provided
        if system_prompt:
            request_params["retrieveAndGenerateConfiguration"]["knowledgeBaseConfiguration"][
                "generationConfiguration"
            ] = {
                "promptTemplate": {
                    "textPromptTemplate": f"{system_prompt}\n\nContext: $search_results$\n\nQuestion: $query$\n\nAnswer:"
                }
            }

        response = bedrock_agent_runtime.retrieve_and_generate(**request_params)

        latency_ms = int((time.time() - start_time) * 1000)

        answer = response.get("output", {}).get("text", "")

        # Extract citations/sources
        sources = []
        citations = response.get("citations", [])
        for citation in citations:
            for ref in citation.get("retrievedReferences", []):
                location = ref.get("location", {})
                s3_location = location.get("s3Location", {})
                source_info = {
                    "uri": s3_location.get("uri", ""),
                    "snippet": ref.get("content", {}).get("text", "")[:200],
                }
                # Avoid duplicate sources
                if source_info["uri"] and source_info not in sources:
                    sources.append(source_info)

        logger.info(f"Bedrock KB query completed in {latency_ms}ms, {len(sources)} sources, {len(retrieved_chunks)} chunks")

        return {
            "answer": answer,
            "sources": sources,
            "retrieved_chunks": retrieved_chunks,
            "latency_ms": latency_ms,
        }

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Bedrock KB query failed: {e}")
        return {
            "answer": f"AI query failed: {str(e)}",
            "sources": [],
            "retrieved_chunks": [],
            "latency_ms": latency_ms,
        }
