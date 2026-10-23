# AI session logs

The assessment asks for the complete, unedited AI transcripts used to build this project.

## What is in this folder

This README describes the folder. It is not the transcript.

`fd6942a5-05f4-4f80-9609-c9a274a5f25a.jsonl` is the Cursor session log for the chat that built this project. One email address in that file was replaced with `[REDACTED]`. The rest of the log is unchanged.

## How to save the real transcript

1. Finish the Cursor chat that built this application.
2. In Cursor, open the chat history for this project. Use the chat's export action if it is available, and save the exported file under `ai-log/` without rewriting it.
3. If the editor does not offer an export, copy the session's `.jsonl` file from the Cursor project data for `tasklist_app` (the `agent-transcripts` directory next to this project's Cursor state) into `ai-log/`.
4. Before a public push, search the copied file for API keys, database passwords, access tokens, and personal data. Redact only those secrets. Leave the rest of the transcript unchanged.
5. Do not commit Cursor's local databases, authentication caches, or `node_modules`.

Until those files are present and checked, the AI-log requirement is not complete.
