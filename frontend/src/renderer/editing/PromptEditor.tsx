import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PromptReference = { kind: 'Picture' | 'Video' | 'Audio'; number: number; name: string; thumbnail?: string }
type Selection = { start: number; end: number }
type Mention = Selection & { query: string; left: number; top: number; width: number; height: number }
const labels = { Picture: '图片', Video: '视频', Audio: '音频' }
const glyphs = { Picture: '▧', Video: '▶', Audio: '♪' }
const tagPattern = () => /<(Picture|Video|Audio)\s+(\d+)\s*>/gi
const tagFor = (item: PromptReference) => `<${item.kind} ${item.number}>`

function readPrompt(root: Node, emptyEditor = false): string {
  if (emptyEditor && root.childNodes.length === 1 && root.firstChild?.nodeName === 'BR') return ''
  let text = ''
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent; return }
    if (!(node instanceof HTMLElement) || node.hasAttribute('data-prompt-end')) return
    if (node.dataset.promptTag) { text += node.dataset.promptTag; return }
    if (node.tagName === 'BR') { text += '\n'; return }
    if (['DIV', 'P'].includes(node.tagName) && text && !text.endsWith('\n')) text += '\n'
    node.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  return text
}

function selectionOffsets(editor: HTMLElement): Selection {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) {
    const end = readPrompt(editor, true).length
    return { start: end, end }
  }
  const range = selection.getRangeAt(0)
  const offset = (node: Node, at: number) => {
    const before = document.createRange()
    before.selectNodeContents(editor)
    before.setEnd(node, at)
    return readPrompt(before.cloneContents()).length
  }
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) }
}

function restoreSelection(editor: HTMLElement, selection: Selection) {
  const boundary = (offset: number): [Node, number] => {
    let seen = 0
    for (const node of editor.childNodes) {
      if (node instanceof HTMLElement && node.hasAttribute('data-prompt-end')) break
      if (offset <= seen) return [editor, Array.prototype.indexOf.call(editor.childNodes, node)]
      const length = node instanceof HTMLElement ? node.dataset.promptTag?.length ?? 1 : node.textContent?.length ?? 0
      if (offset <= seen + length) return node.nodeType === Node.TEXT_NODE ? [node, offset - seen] : [editor, Array.prototype.indexOf.call(editor.childNodes, node) + 1]
      seen += length
    }
    return [editor, editor.childNodes.length - (editor.lastChild instanceof HTMLElement && editor.lastChild.hasAttribute('data-prompt-end') ? 1 : 0)]
  }
  const range = document.createRange()
  range.setStart(...boundary(selection.start))
  range.setEnd(...boundary(selection.end))
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

function renderPrompt(editor: HTMLElement, value: string, references: PromptReference[]) {
  const fragment = document.createDocumentFragment()
  const appendText = (text: string) => text.split('\n').forEach((line, index) => {
    if (index) fragment.append(document.createElement('br'))
    if (line) fragment.append(document.createTextNode(line))
  })
  let cursor = 0
  for (const match of value.matchAll(tagPattern())) {
    appendText(value.slice(cursor, match.index))
    const kind = (Object.keys(labels) as PromptReference['kind'][]).find(kind => kind.toLowerCase() === match[1].toLowerCase())!
    const item = references.find(item => item.kind === kind && item.number === Number(match[2]))
    const chip = document.createElement('span')
    chip.className = `prompt-reference ${kind.toLowerCase()}${item ? '' : ' missing'}`
    chip.contentEditable = 'false'
    chip.dataset.promptTag = match[0]
    chip.title = item ? `${match[0]} · ${item.name}` : `${match[0]} · 素材未上传`
    if (item?.thumbnail) {
      const image = document.createElement('img')
      image.src = item.thumbnail
      image.alt = ''
      image.draggable = false
      chip.append(image)
    } else chip.append(document.createTextNode(`${glyphs[kind]} `))
    chip.append(document.createTextNode(`${labels[kind]}${Number(match[2])}`))
    fragment.append(chip)
    cursor = match.index! + match[0].length
  }
  appendText(value.slice(cursor))
  if (value.endsWith('\n')) {
    const end = document.createElement('br')
    end.dataset.promptEnd = ''
    fragment.append(end)
  }
  editor.replaceChildren(fragment)
}

export function PromptEditor({ value, references, disabled, onChange }: {
  value: string; references: PromptReference[]; disabled: boolean; onChange: (value: string) => void
}) {
  const editor = useRef<HTMLDivElement>(null)
  const menuElement = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const history = useRef({ entries: [{ value, start: value.length, end: value.length }], index: 0 })
  const renderedReferences = useRef('')
  const [mention, setMention] = useState<Mention | null>(null)
  const [active, setActive] = useState(0)
  const listId = useId()
  const host = editor.current?.closest<HTMLElement>('[role="dialog"]')
  const matches = references.filter(item => !mention?.query || `${labels[item.kind]}${item.number} ${tagFor(item)} ${item.name}`.toLowerCase().includes(mention.query.toLowerCase()))
  const selected = Math.min(active, Math.max(0, matches.length - 1))

  useLayoutEffect(() => {
    const element = editor.current!
    const referenceKey = JSON.stringify(references)
    if (composing.current) return
    if (readPrompt(element, true) !== value || referenceKey !== renderedReferences.current) {
      if (history.current.entries[history.current.index].value !== value) history.current = { entries: [{ value, start: value.length, end: value.length }], index: 0 }
      const selection = document.activeElement === element ? selectionOffsets(element) : null
      renderPrompt(element, value, references)
      if (selection) restoreSelection(element, selection)
      renderedReferences.current = referenceKey
    }
    if (disabled) setMention(null)
  }, [value, references, disabled])

  useLayoutEffect(() => {
    if (!mention) return
    const close = (event: Event) => {
      if (!menuElement.current?.contains(event.target as Node)) setMention(null)
    }
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [Boolean(mention)])

  useLayoutEffect(() => {
    const menu = menuElement.current
    const row = menu?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (menu && row) {
      if (row.offsetTop < menu.scrollTop) menu.scrollTop = row.offsetTop
      if (row.offsetTop + row.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight
    }
  }, [selected, mention?.query])

  const rememberSelection = () => {
    const entry = history.current.entries[history.current.index]
    if (entry.value === readPrompt(editor.current!, true)) Object.assign(entry, selectionOffsets(editor.current!))
  }
  const commit = (next: string) => {
    const state = history.current
    if (state.entries[state.index].value !== next) {
      state.entries.splice(state.index + 1)
      state.entries.push({ value: next, ...selectionOffsets(editor.current!) })
      if (state.entries.length > 100) state.entries.shift()
      state.index = state.entries.length - 1
    }
    onChange(next)
  }
  const updateMenu = () => {
    const element = editor.current!
    const dialog = element.closest<HTMLElement>('[role="dialog"]')
    const { start, end } = selectionOffsets(element)
    const query = readPrompt(element, true).slice(0, start).match(/@([^\s@<>]*)$/)
    if (disabled || composing.current || start !== end || !query || !dialog) { setMention(null); return }
    const range = window.getSelection()!.getRangeAt(0).cloneRange()
    range.collapse(false)
    let caret = range.getBoundingClientRect()
    if (!caret.height) caret = element.getBoundingClientRect()
    const bounds = dialog.getBoundingClientRect()
    const width = Math.min(320, bounds.width - 24)
    const below = bounds.bottom - caret.bottom - 16
    const above = caret.top - bounds.top - 16
    const count = references.filter(item => `${labels[item.kind]}${item.number} ${tagFor(item)} ${item.name}`.toLowerCase().includes(query[1].toLowerCase())).length
    const height = Math.min(244, Math.max(below, above), 38 + Math.max(1, count) * 48)
    const top = below >= 160 || below >= above ? caret.bottom - bounds.top + 4 : caret.top - bounds.top - height - 4
    if (query[1] !== mention?.query || start - query[0].length !== mention?.start) setActive(0)
    setMention({ start: start - query[0].length, end, query: query[1], width, height,
      left: Math.max(8, Math.min(caret.left - bounds.left, bounds.width - width - 8)), top: Math.max(8, top) })
  }
  const replace = (text: string, selection = selectionOffsets(editor.current!)) => {
    const element = editor.current!
    rememberSelection()
    const current = readPrompt(element, true)
    const next = current.slice(0, selection.start) + text + current.slice(selection.end)
    renderPrompt(element, next, references)
    element.focus()
    restoreSelection(element, { start: selection.start + text.length, end: selection.start + text.length })
    commit(next)
    setMention(null)
  }
  const insertMention = (item: PromptReference) => { if (mention && !disabled) replace(`${tagFor(item)} `, mention) }
  const sync = () => {
    const element = editor.current!
    const next = readPrompt(element, true)
    if (!composing.current) {
      const selection = selectionOffsets(element)
      const textNodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let rawTag = false
      while (textNodes.nextNode()) if (!(textNodes.currentNode.parentElement?.closest('[data-prompt-tag]')) && tagPattern().test(textNodes.currentNode.textContent ?? '')) rawTag = true
      if (rawTag || element.querySelector('div, p')) {
        renderPrompt(element, next, references)
        restoreSelection(element, selection)
      }
      commit(next)
      updateMenu()
    } else onChange(next)
  }
  const undo = (direction: number) => {
    const state = history.current
    state.index = Math.max(0, Math.min(state.entries.length - 1, state.index + direction))
    const entry = state.entries[state.index]
    renderPrompt(editor.current!, entry.value, references)
    restoreSelection(editor.current!, entry)
    onChange(entry.value)
    setMention(null)
  }
  const deleteTag = (backwards: boolean) => {
    const selection = selectionOffsets(editor.current!)
    if (selection.start !== selection.end) return false
    const text = readPrompt(editor.current!, true)
    const tag = backwards ? /<(?:Picture|Video|Audio)\s+\d+\s*>$/i.exec(text.slice(0, selection.start)) : /^<(?:Picture|Video|Audio)\s+\d+\s*>/i.exec(text.slice(selection.end))
    if (!tag) return false
    replace('', { start: selection.start - (backwards ? tag[0].length : 0), end: selection.end + (backwards ? 0 : tag[0].length) })
    return true
  }

  return <div className="prompt-field">
    <span id={`${listId}-label`}>提示词</span>
    <div ref={editor} className="prompt-editor" contentEditable={!disabled} suppressContentEditableWarning
      role="textbox" aria-label="提示词" aria-multiline="true" aria-required="true" aria-disabled={disabled}
      aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={Boolean(mention)} aria-controls={mention ? listId : undefined}
      aria-activedescendant={mention && matches.length ? `${listId}-${selected}` : undefined}
      data-placeholder="描述画面；输入 @ 选择已上传的参考素材" tabIndex={disabled ? -1 : 0}
      onInput={sync} onCompositionStart={() => { composing.current = true; setMention(null) }}
      onCompositionEnd={() => { composing.current = false; sync() }}
      onBeforeInput={event => {
        if (composing.current || disabled) return
        rememberSelection()
        const type = (event.nativeEvent as InputEvent).inputType
        if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); undo(type === 'historyUndo' ? -1 : 1) }
        if (type === 'insertParagraph' || type === 'insertLineBreak') { event.preventDefault(); replace('\n') }
        if ((type === 'deleteContentBackward' || type === 'deleteContentForward') && deleteTag(type === 'deleteContentBackward')) event.preventDefault()
      }}
      onKeyDown={event => {
        event.stopPropagation()
        if (disabled || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        rememberSelection()
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault(); undo(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1); return
        }
        if (mention) {
          if (event.key === 'Escape') { event.preventDefault(); setMention(null); return }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault(); setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1)); return
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && matches.length) { event.preventDefault(); insertMention(matches[selected]); return }
        }
        if (event.key === 'Enter') { event.preventDefault(); replace('\n') }
        if (!event.ctrlKey && !event.altKey && !event.metaKey && ['Backspace', 'Delete'].includes(event.key) && deleteTag(event.key === 'Backspace')) event.preventDefault()
      }}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMenu() }}
      onPointerDown={event => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-prompt-tag]')
        if (!chip || event.shiftKey) return
        event.preventDefault()
        const range = document.createRange(), bounds = chip.getBoundingClientRect()
        if (event.clientX < bounds.left + bounds.width / 2) range.setStartBefore(chip)
        else range.setStartAfter(chip)
        range.collapse(true)
        editor.current!.focus()
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
        setMention(null)
      }}
      onClick={updateMenu} onBlur={() => setMention(null)}
      onCopy={event => {
        event.stopPropagation()
        const { start, end } = selectionOffsets(editor.current!)
        if (start === end) return
        event.preventDefault(); event.clipboardData.setData('text/plain', readPrompt(editor.current!, true).slice(start, end))
      }}
      onCut={event => {
        event.stopPropagation()
        if (disabled) return
        const selection = selectionOffsets(editor.current!)
        if (selection.start === selection.end) return
        event.preventDefault(); event.clipboardData.setData('text/plain', readPrompt(editor.current!, true).slice(selection.start, selection.end)); replace('', selection)
      }}
      onPaste={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) replace(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')) }}
      onDrop={event => event.preventDefault()} />
    <small>输入 @ 选择参考素材，支持 ↑↓ 选择、Enter 确认。</small>
    {mention && host && createPortal(<div ref={menuElement} id={listId} role="listbox" aria-label="选择参考素材" className="prompt-mention-menu"
      style={{ left: mention.left, top: mention.top, width: mention.width, maxHeight: mention.height }} onPointerDown={event => event.preventDefault()}>
      <div className="prompt-mention-title">选择参考素材</div>
      {matches.length ? matches.map((item, index) => <div key={tagFor(item)} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
        className={`prompt-mention-option ${item.kind.toLowerCase()}`} onPointerMove={() => setActive(index)} onClick={() => insertMention(item)}>
        <span className="prompt-mention-thumb">{item.thumbnail ? <img src={item.thumbnail} alt="" /> : glyphs[item.kind]}</span>
        <span><strong>{labels[item.kind]}{item.number}</strong><small>{item.name}</small></span>
      </div>) : <div className="prompt-mention-empty">{references.length ? '没有匹配的素材' : '请先上传参考素材'}</div>}
    </div>, host)}
  </div>
}
