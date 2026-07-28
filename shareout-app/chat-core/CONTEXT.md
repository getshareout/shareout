# Streaming Chat (chat-core)

The shared reading-behaviour engine behind every ShareOut chat surface (home dock,
visual-editor agent, create builder, visitor SDK widget). It exists so the rule
"never move the reader against their intent" is implemented once and inherited by
every surface.

## Language

**Surface**:
One chat UI that consumes chat-core — the dock, editor, create page, or SDK widget.
Each keeps its own markup/CSS; only reading behaviour is shared.
_Avoid_: client, view (view = one DOM message-list wrapper, narrower).

**Live edge**:
The bottom of the message list, where the newest content appears. "At the edge"
means within the follow threshold (60px) of it.
_Avoid_: bottom (ambiguous with scrollbar bottom).

**Following**:
The reading mode where the surface keeps the live edge in view as content streams.
True only while the reader is at the edge.
_Avoid_: autoscroll, stick (stick = the action, follow = the state).

**Hold (anchor-and-hold)**:
The reading mode after a new turn: the reader's message is anchored near the top and
the answer fills the space below it *without scrolling*, until the answer reaches the
viewport bottom (then it switches to Following).
_Avoid_: pinned, frozen.

**Away**:
The reading mode after the reader scrolls off the live edge. New content does not move
them; it accrues as Unread.
_Avoid_: scrolled-up.

**Intent**:
Any reader action that should stop the interface from moving — scrolling away or
selecting text inside the list. Detected, never overridden.
_Avoid_: gesture, interaction (too broad).

**Anchor**:
A message scrolled to a deliberate position — near the top for a new turn, or into
view for a search hit / reopen point.

**Unread**:
Count of messages that arrived while Away. Shown on the jump-to-latest control;
cleared on return to the edge.

**Reopen point**:
Where a saved thread opens — the last user message, not the absolute bottom, so the
reader resumes at the last thing they asked.
