#!/bin/bash
# Google Workspace Wrapper - General Command Executor

SERVICE=$1
ACTION=$2
shift 2

WORKSPACE="$HOME/.openclaw/workspace"
CMD="~/.openclaw/venv/bin/python"

cd "$WORKSPACE" || exit 1

case "$SERVICE:$ACTION" in
    gmail:list)
        $CMD google-workspace.py gmail list --limit ${1:-10}
        ;;
    gmail:send)
        $CMD google-workspace.py gmail send --to "$1" --subject "$2" --body "$3"
        ;;
    calendar:list)
        $CMD google-workspace.py calendar list --days ${1:-7}
        ;;
    calendar:create)
        $CMD google-workspace.py calendar create \
            --summary "$1" \
            --start "$2" \
            ${3:+--end "$3"} \
            ${4:+--location "$4"} \
            ${5:+--description "$5"}
        ;;
    drive:list)
        $CMD google-workspace.py drive list --limit ${1:-20}
        ;;
    drive:search)
        $CMD google-workspace.py drive search --query "$1" --limit ${2:-10}
        ;;
    sheets:read)
        $CMD google-workspace.py sheets read --id "$1" --range "$2"
        ;;
    sheets:write)
        $CMD google-workspace.py sheets write --id "$1" --range "$2" --data "$3"
        ;;
    sheets:append)
        $CMD google-workspace.py sheets append --id "$1" --range "$2" --data "$3"
        ;;
    docs:read)
        $CMD google-workspace.py docs read --id "$1"
        ;;
    *)
        echo "Usage: google <service> <action> [args...]"
        echo ""
        echo "Services: gmail, calendar, drive, sheets, docs"
        echo ""
        echo "Examples:"
        echo "  google gmail list 10"
        echo "  google calendar list 7"
        echo "  google sheets read <id> 'Sheet1!A1:D10'"
        exit 1
        ;;
esac