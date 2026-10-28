/** An edit the workflow cannot take as asked; its message tells the developer why. */
export class RefusedEdit extends Error {
  constructor(message) {
    super(message)
    this.name = 'RefusedEdit'
  }
}
