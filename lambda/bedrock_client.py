"""Bedrock Knowledge Base client."""

import os
import time
import logging
from typing import Any

import boto3

logger = logging.getLogger(__name__)

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")


def query_knowledge_base(
    question: str,
    kb_id: str | None = None,
    model_id: str | None = None,
    system_prompt: str | None = None,
) -> dict:
    """
    Query Bedrock Knowledge Base using RetrieveAndGenerate API.
    
    Returns:
        {
            "answer": str,
            "sources": [{"uri": str, "title": str, "snippet": str}],
            "latency_ms": int,
        }
    """
    kb_id = kb_id or os.environ.get("BEDROCK_KB_ID", "")
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
    system_prompt = system_prompt or os.environ.get("SYSTEM_PROMPT", "")

    if not kb_id:
        logger.error("No Knowledge Base ID configured")
        return {
            "answer": "Knowledge Base not configured. Please set the KB ID in settings.",
            "sources": [],
            "latency_ms": 0,
        }

    # Build model ARN
    region = os.environ.get("AWS_REGION", "us-west-2")
    model_arn = f"arn:aws:bedrock:{region}::foundation-model/{model_id}"

    start_time = time.time()

    try:
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

        logger.info(f"Bedrock KB query completed in {latency_ms}ms, {len(sources)} sources")

        return {
            "answer": answer,
            "sources": sources,
            "latency_ms": latency_ms,
        }

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Bedrock KB query failed: {e}")
        return {
            "answer": f"AI query failed: {str(e)}",
            "sources": [],
            "latency_ms": latency_ms,
        }
