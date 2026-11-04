# Form steps must carry current state in the interrupt payload

The form node runs `interrupt(...)` with only its field *definitions*. Nothing downstream (inbox
task row, `home`'s inbox page) can see the LangGraph state, so every form opened empty even when
an earlier step had set the same keys. Fix: the node handler receives `state` and copies
`state[field.key]` into `field.value` before interrupting; `home` prefills from `field.value`.
Unset keys (undefined) are left without a `value`.
