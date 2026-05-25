# Memory Management Protocol

## Principle
**Isolate topic context, share important knowledge**

## Hierarchy

**Level 1: MEMORY.md (Main)**
- System configuration
- Important decisions
- Long-term knowledge
- Cross-topic patterns

**Level 2: memory/topics/<topic-name>.md (Topic)**
- Topic-specific context
- Current progress
- Topic decisions
- Related links

**Level 3: memory/YYYY-MM-DD.md (Daily)**
- All activities
- Topic summaries
- Raw data for processing

## Update Rules

**When to update MEMORY.md:**
- System changes
- Important decisions
- Patterns learned
- Cross-topic insights

**When to update topic memory:**
- Topic progress
- Topic-specific decisions
- Context for that topic only

**When to update daily log:**
- All activities
- Quick notes
- For later synthesis

## File Naming Convention

**Topics:** `memory/topics/<topic-name>.md`
- Use topic name from Telegram
- Replace spaces with underscores
- Lowercase only

**Examples:**
- "Development" → `memory/topics/development.md`
- "Planning" → `memory/topics/planning.md`
- "Support" → `memory/topics/support.md`

## Search Strategy

Before answering:
1. Search topic memory first
2. Search main memory
3. Search recent daily logs
4. Combine insights

## Weekly Review

Every 7 days:
1. Review topic memories
2. Promote important items to main memory
3. Archive old daily logs
4. Clean up duplicates