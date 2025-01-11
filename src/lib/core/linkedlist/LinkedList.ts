import { Node } from "./Node";

export class LinkedList<T> {
  #sentinel: Node<T> = new Node<T>();
  #length: number = 0;

  constructor() {
    this.#sentinel.next = this.#sentinel;
    this.#sentinel.prev = this.#sentinel;
  }

  get sentinel(): Node<T> {
    return this.#sentinel;
  }

  get head() {
    return this.#sentinel.next === this.#sentinel ? null : this.#sentinel.next;
  }

  get tail() {
    return this.#sentinel.prev === this.#sentinel ? null : this.#sentinel.prev;
  }

  delete(node: Node<T>): void {
    this.#length -= 1;
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  insertEnd(node: Node<T>): void {
    node.prev = this.#sentinel.prev;
    node.next = this.#sentinel;
    this.#sentinel.prev.next = node;
    this.#sentinel.prev = node;
    this.#length += 1;
  }

  get length(): number {
    return this.#length;
  }
}
