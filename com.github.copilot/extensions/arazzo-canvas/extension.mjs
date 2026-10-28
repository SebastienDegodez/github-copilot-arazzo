// Copilot CLI extension entry, the only file that imports the SDK.
import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension'
import { register } from '../../../src/composition.mjs'

// stdout carries JSON-RPC: the log goes to stderr, the extension's log file
await register({ joinSession, createCanvas, CanvasError, root: process.cwd(), log: (text) => void process.stderr.write(`${text}\n`) })
