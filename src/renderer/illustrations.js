'use strict'

const illustrations = {
  'no-box': {
    label: 'A Fetch box and a computer with no line between them',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160" class="ill" aria-hidden="true">' +
      '<rect x="0" y="0" width="320" height="160" rx="8" class="f-p"/>' +
      '<rect x="24" y="86" width="104" height="34" rx="6" class="f-k2"/>' +
      '<rect x="36" y="101" width="18" height="5" rx="2.5" class="f-k3"/>' +
      '<circle cx="114" cy="103" r="3.5" class="f-y"/>' +
      '<rect x="196" y="48" width="100" height="66" rx="6" class="f-k2"/>' +
      '<rect x="204" y="56" width="84" height="50" rx="3" class="f-b" opacity="0.35"/>' +
      '<rect x="184" y="114" width="124" height="10" rx="5" class="f-k1"/>' +
      '<path d="M128 96C142 80 150 76 160 74" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12" class="s-ink"/>' +
      '<path d="M176 72C182 71 188 72 194 74" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12" class="s-ink"/>' +
      '<circle cx="168" cy="60" r="11" class="f-k1"/>' +
      '<rect x="166" y="53" width="4" height="9" rx="2" class="f-o"/>' +
      '<circle cx="168" cy="66" r="2.2" class="f-o"/>' +
      '</svg>'
  },
  'no-recordings': {
    label: 'An empty shelf where recordings would be',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160" class="ill" aria-hidden="true">' +
      '<rect x="0" y="0" width="320" height="160" rx="8" class="f-p"/>' +
      '<rect x="56" y="118" width="208" height="10" rx="5" class="f-k2"/>' +
      '<rect x="72" y="58" width="44" height="60" rx="5" fill="none" stroke-width="3" stroke-dasharray="6 6" class="s-k3"/>' +
      '<rect x="138" y="58" width="44" height="60" rx="5" fill="none" stroke-width="3" stroke-dasharray="6 6" class="s-k3"/>' +
      '<rect x="204" y="58" width="44" height="60" rx="5" fill="none" stroke-width="3" stroke-dasharray="6 6" class="s-k3"/>' +
      '<rect x="134" y="26" width="52" height="8" rx="4" class="f-b" opacity="0.8"/>' +
      '<rect x="146" y="38" width="28" height="8" rx="4" class="f-o" opacity="0.8"/>' +
      '</svg>'
  },
  'watch-card': {
    label: 'A folder of recordings going to a TV',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" width="160" height="96" class="ill" aria-hidden="true">' +
      '<rect x="8" y="34" width="54" height="40" rx="5" class="f-k2"/>' +
      '<rect x="8" y="28" width="24" height="10" rx="3" class="f-k2"/>' +
      '<rect x="16" y="44" width="30" height="5" rx="2.5" class="f-b"/>' +
      '<rect x="16" y="53" width="30" height="5" rx="2.5" class="f-o"/>' +
      '<rect x="16" y="62" width="30" height="5" rx="2.5" class="f-y"/>' +
      '<path d="M70 50H88" fill="none" stroke-width="5" stroke-linecap="round" class="s-mint"/>' +
      '<path d="M83 43l7 7-7 7" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" class="s-mint"/>' +
      '<rect x="98" y="22" width="56" height="40" rx="5" class="f-k2"/>' +
      '<rect x="103" y="27" width="46" height="30" rx="2" class="f-b" opacity="0.35"/>' +
      '<rect x="121" y="62" width="10" height="8" class="f-k2"/>' +
      '<rect x="112" y="70" width="28" height="5" rx="2.5" class="f-k2"/>' +
      '</svg>'
  },
  'watch-computer': {
    label: 'A laptop playing a recording',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" width="240" height="96" class="ill" aria-hidden="true">' +
      '<rect x="62" y="10" width="116" height="70" rx="6" class="f-k2"/>' +
      '<rect x="70" y="18" width="100" height="54" rx="3" class="f-b" opacity="0.3"/>' +
      '<path d="M112 34v20l17-10z" class="f-mint"/>' +
      '<rect x="48" y="80" width="144" height="9" rx="4.5" class="f-k1"/>' +
      '</svg>'
  },
  'watch-tv': {
    label: 'A TV playing a recording',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" width="240" height="96" class="ill" aria-hidden="true">' +
      '<rect x="56" y="6" width="128" height="72" rx="6" class="f-k2"/>' +
      '<rect x="64" y="14" width="112" height="56" rx="3" class="f-b" opacity="0.3"/>' +
      '<path d="M112 31v22l18-11z" class="f-mint"/>' +
      '<rect x="112" y="78" width="16" height="8" class="f-k2"/>' +
      '<rect x="96" y="86" width="48" height="6" rx="3" class="f-k2"/>' +
      '</svg>'
  },
  'watch-record': {
    label: 'An aerial connected to a TV tuner',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" width="240" height="96" class="ill" aria-hidden="true">' +
      '<path d="M78 14V84" fill="none" stroke-width="5" stroke-linecap="round" class="s-k3"/>' +
      '<path d="M58 22H98M62 34H94M66 46H90" fill="none" stroke-width="5" stroke-linecap="round" class="s-k3"/>' +
      '<path d="M78 84C96 84 104 70 122 70" fill="none" stroke-width="4" stroke-linecap="round" class="s-ink"/>' +
      '<rect x="122" y="56" width="66" height="28" rx="5" class="f-k2"/>' +
      '<rect x="132" y="67" width="20" height="5" rx="2.5" class="f-k3"/>' +
      '<circle cx="176" cy="70" r="4" class="f-live"/>' +
      '</svg>'
  }
}

const illustration = (name) => {
  const figure = document.createElement('figure')
  figure.className = 'illustration'
  figure.setAttribute('role', 'img')
  figure.setAttribute('aria-label', illustrations[name].label)
  figure.innerHTML = illustrations[name].svg
  return figure
}

const lineIcons = {
  computer: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" class="line-icon"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
  tv: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" class="line-icon"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M9 21h6M12 17v4"/></svg>',
  record: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" class="line-icon"><path d="M8 3v18M4 6h8M5 10h6M6 14h4"/><rect x="14" y="14" width="8" height="6" rx="1"/><path d="M8 21c3 0 4-3 6-3"/></svg>'
}

const lineIcon = (name) => {
  const span = document.createElement('span')
  span.className = 'tab-icon'
  span.innerHTML = lineIcons[name]
  return span
}
