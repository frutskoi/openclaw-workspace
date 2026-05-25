# Topics Memory Structure

## Purpose
Each Telegram topic gets its own memory file for context isolation, while important information flows to main memory.

## Structure
- `memory/topics/<topic-name>.md` — Per-topic context
- `MEMORY.md` — Long-term important information
- `memory/YYYY-MM-DD.md` — Daily logs

## Memory Flows

**To main memory (MEMORY.md):**
- Important decisions
- System changes
- Long-term knowledge
- Cross-topic insights

**To topic memory (memory/topics/<topic-name>.md):**
- Topic-specific context
- Current progress
- Topic-specific decisions

**To daily logs (memory/YYYY-MM-DD.md):**
- All activities
- Topic summaries
- For later processing

## Usage
When working in a Telegram topic:
1. Check topic memory first
2. Update topic memory with progress
3. Promote important items to main memory