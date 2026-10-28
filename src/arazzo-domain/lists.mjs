/** A list of an Arazzo document that may be left out, or written as something else than a list. */
export const listOf = (value) => (Array.isArray(value) ? value : [])

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The items of a list as objects: an item of another kind stands as an empty one, so each keeps its place. */
export const objectsOf = (value) => listOf(value).map((item) => (isObject(item) ? item : {}))

/** An object of an Arazzo document that may be left out, or written as something else than an object. */
export const mapOf = (value) => (isObject(value) ? value : {})
