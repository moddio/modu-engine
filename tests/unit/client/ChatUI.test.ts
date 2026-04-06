import { describe, it, expect, vi } from 'vitest';
import { ChatUI } from '../../../engine/client/ui/ChatUI';
import type { ChatMessage } from '../../../engine/client/ui/ChatUI';

function makeMsg(text: string, playerId = 'p1'): ChatMessage {
  return { playerId, playerName: 'Player', text, timestamp: Date.now() };
}

describe('ChatUI', () => {
  it('starts hidden with no messages', () => {
    const chat = new ChatUI();
    expect(chat.visible).toBe(false);
    expect(chat.messages).toEqual([]);
  });

  it('addMessage stores message and emits', () => {
    const chat = new ChatUI();
    const fn = vi.fn();
    chat.events.on('message', fn);
    const msg = makeMsg('hello');
    chat.addMessage(msg);
    expect(chat.messages.length).toBe(1);
    expect(chat.messages[0].text).toBe('hello');
    expect(fn).toHaveBeenCalledWith(msg);
  });

  it('caps at maxMessages', () => {
    const chat = new ChatUI(3);
    chat.addMessage(makeMsg('a'));
    chat.addMessage(makeMsg('b'));
    chat.addMessage(makeMsg('c'));
    chat.addMessage(makeMsg('d'));
    expect(chat.messages.length).toBe(3);
    expect(chat.messages[0].text).toBe('b');
    expect(chat.messages[2].text).toBe('d');
  });

  it('clear empties messages and emits cleared', () => {
    const chat = new ChatUI();
    const fn = vi.fn();
    chat.events.on('cleared', fn);
    chat.addMessage(makeMsg('test'));
    chat.clear();
    expect(chat.messages).toEqual([]);
    expect(fn).toHaveBeenCalled();
  });

  it('show/hide toggle visibility and emit events', () => {
    const chat = new ChatUI();
    const showFn = vi.fn();
    const hideFn = vi.fn();
    chat.events.on('show', showFn);
    chat.events.on('hide', hideFn);

    chat.show();
    expect(chat.visible).toBe(true);
    expect(showFn).toHaveBeenCalled();

    chat.hide();
    expect(chat.visible).toBe(false);
    expect(hideFn).toHaveBeenCalled();
  });

  it('destroy hides and clears messages', () => {
    const chat = new ChatUI();
    chat.addMessage(makeMsg('test'));
    chat.show();
    chat.destroy();
    expect(chat.visible).toBe(false);
    expect(chat.messages).toEqual([]);
  });

  it('defaults to 100 maxMessages', () => {
    const chat = new ChatUI();
    expect(chat.maxMessages).toBe(100);
  });
});
