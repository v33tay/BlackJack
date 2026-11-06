"use strict";

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.parentElement = null;
    this.textContent = "";
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.value = "";
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] ?? null;
  }

  append(...elements) {
    for (const element of elements) {
      element.remove();
      element.parentElement = this;
      this.children.push(element);
    }
  }

  replaceChildren(...elements) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...elements);
  }

  replaceChild(replacement, existing) {
    const index = this.children.indexOf(existing);
    if (index === -1) throw new Error("Element to replace was not found.");
    replacement.remove();
    existing.parentElement = null;
    replacement.parentElement = this;
    this.children[index] = replacement;
  }

  insertBefore(element, reference) {
    if (element === reference) return element;
    element.remove();
    element.parentElement = this;
    if (reference === null) {
      this.children.push(element);
      return element;
    }
    const index = this.children.indexOf(reference);
    if (index === -1) throw new Error("Reference element was not found.");
    this.children.splice(index, 0, element);
    return element;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  focus() {}

  click() {
    this.listeners.click?.();
  }

  change() {
    this.listeners.change?.();
  }
}

function createDom(elements) {
  return {
    activeElement: null,
    querySelector(selector) {
      return elements[selector.slice(1)];
    },
    createElement(tagName) {
      return new TestElement(tagName);
    }
  };
}

function createTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    }
  };
}

function createStorage() {
  const storage = new Map();
  return {
    storage,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    }
  };
}

module.exports = { TestElement, createDom, createTimers, createStorage };
