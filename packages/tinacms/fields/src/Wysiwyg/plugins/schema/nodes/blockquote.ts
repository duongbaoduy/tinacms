import { SchemaNodePlugin } from '../..'

export const blockquote = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() {
    return ['blockquote', 0]
  },
}

export default {
  __type: 'wysiwyg:schema:node',
  name: 'blockquote',
  node: blockquote,
} as SchemaNodePlugin