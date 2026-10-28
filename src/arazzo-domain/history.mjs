// The texts the document went through, to undo an edit and redo it. An edit after an undo drops what
// could be redone.
import { RefusedEdit } from './refused-edit.mjs'

export const startHistory = (present) => ({ past: [], present, future: [] })

export const record = ({ past, present }, next) => ({ past: [...past, present], present: next, future: [] })

export const undo = ({ past, present, future }) => {
  if (!past.length) throw new RefusedEdit('there is no edit to undo')
  return { past: past.slice(0, -1), present: past.at(-1), future: [present, ...future] }
}

export const redo = ({ past, present, future }) => {
  if (!future.length) throw new RefusedEdit('there is no edit to redo')
  return { past: [...past, present], present: future[0], future: future.slice(1) }
}
