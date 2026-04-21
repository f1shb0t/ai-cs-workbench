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
    session_id: str | None = None,
    conversation_history: list[dict] | None = None,
) -> dict:
    """
    Query Bedrock Knowledge Base using RetrieveAndGenerate API,
    and also call Retrieve API for raw chunks.

    Args:
        question: current user question.
        kb_id: Knowledge Base ID.
        model_id: inference profile or foundation model id.
        system_prompt: custom prompt template (optional).
        session_id: Bedrock RetrieveAndGenerate sessionId for multi-turn. When
            provided, Bedrock keeps server-side conversation history. Pass None
            to start a new session.
        conversation_history: Optional fallback history [{role, content}, ...]
            used to prepend context into the prompt. Only applied when
            session_id is None (e.g. regenerate / new ticket with prior turns).

    Returns:
        {
            "answer": str,
            "sources": [{"uri": str, "snippet": str}],
            "retrieved_chunks": [{"content": str, "score": float, "uri": str}],
            "latency_ms": int,
            "session_id": str,  # new or refreshed session id
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
            "session_id": session_id or "",
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

        # Build effective system prompt. If we don't have a live Bedrock session
        # but do have local history, embed it so the model has context.
        effective_system_prompt = system_prompt or ""
        if not session_id and conversation_history:
            history_lines = []
            for turn in conversation_history:
                role = turn.get("role", "")
                content = (turn.get("content") or "").strip()
                if not content:
                    continue
                if role == "user":
                    history_lines.append(f"玩家: {content}")
                elif role == "assistant":
                    history_lines.append(f"客服: {content}")
            if history_lines:
                history_block = "\n".join(history_lines)
                context_hint = (
                    "以下是本工单此前的对话历史，请在回答当前问题时参考上下文，"
                    "但不要直接复述历史内容：\n"
                    f"{history_block}\n"
                )
                effective_system_prompt = (
                    f"{effective_system_prompt}\n\n{context_hint}".strip()
                )

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

        # Reuse server-side Bedrock session when available
        if session_id:
            request_params["sessionId"] = session_id

        # Add generation configuration with system prompt if provided
        if effective_system_prompt:
            request_params["retrieveAndGenerateConfiguration"]["knowledgeBaseConfiguration"][
                "generationConfiguration"
            ] = {
                "promptTemplate": {
                    "textPromptTemplate": f"{effective_system_prompt}\n\nContext: $search_results$\n\nQuestion: $query$\n\nAnswer:"
                }
            }

        try:
            response = bedrock_agent_runtime.retrieve_and_generate(**request_params)
        except bedrock_agent_runtime.exceptions.ValidationException as e:
            # sessionId expired / invalid - retry without it
            if session_id and "session" in str(e).lower():
                logger.warning(f"Bedrock session {session_id} invalid, restarting: {e}")
                request_params.pop("sessionId", None)
                response = bedrock_agent_runtime.retrieve_and_generate(**request_params)
            else:
                raise

        latency_ms = int((time.time() - start_time) * 1000)

        answer = response.get("output", {}).get("text", "")
        new_session_id = response.get("sessionId", "") or session_id or ""

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

        logger.info(f"Bedrock KB query completed in {latency_ms}ms, {len(sources)} sources, {len(retrieved_chunks)} chunks, session={new_session_id[:12] if new_session_id else 'new'}")

        return {
            "answer": answer,
            "sources": sources,
            "retrieved_chunks": retrieved_chunks,
            "latency_ms": latency_ms,
            "session_id": new_session_id,
        }

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Bedrock KB query failed: {e}")
        return {
            "answer": f"AI query failed: {str(e)}",
            "sources": [],
            "retrieved_chunks": [],
            "latency_ms": latency_ms,
            "session_id": session_id or "",
        }
