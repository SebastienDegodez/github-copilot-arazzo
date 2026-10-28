// The timeline of the video, shared by the picture (app.jsx) and the soundtrack (audio.mjs): when
// each edit lands, what the narrator says and which sound plays, in seconds.

export const DURATION = 56

export const CHAPTERS = [
  { at: 0, name: 'Hook' },
  { at: 4.2, name: 'Open' },
  { at: 11.4, name: 'Drag' },
  { at: 19.6, name: 'Wire' },
  { at: 23.4, name: 'Ask' },
  { at: 29.6, name: 'Copilot' },
  { at: 40.4, name: 'Result' },
  { at: 47.4, name: 'Install' },
]

/** When each edit of the scenario lands on the canvas. */
export const LANDS = {
  open: 9.4, input: 10.6, findPets: 14.55, getPet: 16.95, placeOrder: 19.15, status: 21.75,
  petIdOut: 31.5, petIdIn: 33.1, retry: 34.7, orderIdOut: 36.3, orderId: 37.9,
}

/** What is typed, and when: the chat prompt, then the question asked from the canvas. */
export const TYPING = {
  prompt: { from: 5.6, to: 8.1, text: 'Open the Arazzo canvas on workflows/adopt.arazzo.yaml for the Petstore API, with a status input.' },
  question: { from: 25.0, to: 28.0, text: 'Pass the pet found to getPet, retry the order if it fails, and return the order id.' },
}

/** The narration: each line is said between `at` and `end`, faster if it would not fit; `fr` is its French subtitle. */
export const NARRATION = [
  { at: 0.4, end: 4.7, text: 'Chaining API calls in Arazzo? Usually: YAML, by hand.',
    fr: 'Enchaîner des appels d’API en Arazzo ? D’habitude : du YAML, à la main.' },
  { at: 4.8, end: 11.3, text: 'Meet the Arazzo canvas, inside the GitHub Copilot app. Just ask, and Copilot opens your workflow.',
    fr: 'Voici le canvas Arazzo, dans l’app GitHub Copilot. Il suffit de demander : Copilot ouvre votre workflow.' },
  { at: 12.6, end: 19.5, text: 'Your API operations are right there. Drag them onto the canvas: each drop adds a step, saved to the file.',
    fr: 'Les opérations de votre API sont là. Glissez-les sur le canvas : chaque dépôt ajoute une étape, enregistrée dans le fichier.' },
  { at: 19.8, end: 23.5, text: 'Then wire an input to a parameter.',
    fr: 'Puis reliez une entrée à un paramètre.' },
  { at: 23.9, end: 29.6, text: 'Or let Copilot write the rest. Ask from the canvas, about the step you selected.',
    fr: 'Ou laissez Copilot écrire la suite. Posez votre question depuis le canvas, sur l’étape sélectionnée.' },
  { at: 30.3, end: 40.3, text: 'Copilot edits the very same canvas. It passes the pet id, retries the order, and returns its id. You watch every change land.',
    fr: 'Copilot modifie le même canvas. Il transmet l’id de l’animal, relance la commande et renvoie son id. Vous voyez chaque changement arriver.' },
  { at: 41.9, end: 47.3, text: 'The result: valid Arazzo, written to your file as you go.',
    fr: 'Résultat : de l’Arazzo valide, écrit dans votre fichier au fil de l’eau.' },
  { at: 48.0, end: 55.0, text: 'The Arazzo canvas for GitHub Copilot. Drag, wire, ask.',
    fr: 'Le canvas Arazzo pour GitHub Copilot. Glisser, relier, demander.' },
]

/** The sound effects: pointer clicks, drops, Copilot's actions completing, transitions. */
export const SOUNDS = {
  click: [5.3, 8.35, 13.3, 15.6, 17.9, 20.3, 23.6, 24.6, 28.5],
  drop: [LANDS.findPets, LANDS.getPet, LANDS.placeOrder, LANDS.status],
  send: [8.4, 28.7],
  done: [30.8, LANDS.open, LANDS.input, LANDS.petIdOut, LANDS.petIdIn, LANDS.retry, LANDS.orderIdOut, LANDS.orderId],
  whoosh: [2.35, 4.1, 9.25, 11.5, 28.85, 40.5],
  chime: [47.5],
}
