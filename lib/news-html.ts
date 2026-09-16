/**
 * What an announcement is allowed to contain.
 *
 * The body is authored as HTML and rendered as HTML, so it is sanitised on the
 * way in — once, at the point of storage, rather than hopefully at every point
 * of display. Authors here are trusted colleagues, which is a reason to keep
 * the allowlist generous, not a reason to skip it: a pasted fragment from a
 * supplier's email carries whatever that email carried.
 *
 * Images are the one thing that cannot be freely sourced. Every picture must
 * come from our own route, so an announcement cannot quietly report who opened
 * it and when to a third party's server.
 */

import sanitizeHtml from 'sanitize-html'

const OWN_IMAGE = /^\/api\/news\/images\?path=[A-Za-z0-9/_.-]+$/

export function cleanNewsHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', {
    allowedTags: [
      'p', 'br', 'div', 'span',
      'h1', 'h2', 'h3', 'h4',
      'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'mark', 'sub', 'sup',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z-]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z-]+$/i],
        'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'text-align': [/^(left|right|center|justify)$/],
        'text-decoration': [/^[a-z\s-]+$/],
      },
    },
    // Only http(s) links, and only our own images
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: [] },
    transformTags: {
      // A link out of the panel opens elsewhere, and never gets to touch the
      // page that opened it
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
    exclusiveFilter: frame =>
      frame.tag === 'img' && !OWN_IMAGE.test(frame.attribs.src ?? ''),
  })
}

/** A plain-text opening line, for the list and for the notification. */
export function newsExcerpt(html: string, limit = 160): string {
  const text = sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
