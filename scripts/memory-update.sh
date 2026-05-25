#!/bin/bash
# Memory helper for topic-based Telegram chats

TOPIC_NAME="$1"
shift
ACTION="$1"
shift
CONTENT="$@"

TOPIC_FILE="memory/topics/${TOPIC_NAME}.md"
MAIN_MEMORY="MEMORY.md"
DAILY_LOG="memory/$(date +%Y-%m-%d).md"

case "$ACTION" in
  topic)
    # Update topic memory
    echo "## $(date '+%Y-%m-%d %H:%M')" >> "$TOPIC_FILE"
    echo "$CONTENT" >> "$TOPIC_FILE"
    echo "" >> "$TOPIC_FILE"
    ;;
  main)
    # Update main memory
    echo "## $(date '+%Y-%m-%d %H:%M')" >> "$MAIN_MEMORY"
    echo "$CONTENT" >> "$MAIN_MEMORY"
    echo "" >> "$MAIN_MEMORY"
    ;;
  daily)
    # Update daily log
    echo "## $(date '+%H:%M') - $TOPIC_NAME" >> "$DAILY_LOG"
    echo "$CONTENT" >> "$DAILY_LOG"
    echo "" >> "$DAILY_LOG"
    ;;
  *)
    echo "Usage: $0 <topic_name> <topic|main|daily> <content>"
    exit 1
    ;;
esac