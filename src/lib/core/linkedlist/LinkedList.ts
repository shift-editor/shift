import { Node } from "./Node";

export class LinkedList<T> {
  #sentinel: Node<T> = new Node();
  #length: number = 0;

  constructor() {
    this.#sentinel.next = this.#sentinel;
    this.#sentinel.prev = this.#sentinel;
  }

  get head() {
    return this.#sentinel.prev;
  }

  get tail() {
    return this.#sentinel.next;
  }

  delete(node: Node<T>): void {
    this.#length -= 1;
    node;
  }

  insertEnd(node: Node<T>): void {
    this.#sentinel.prev.next = node;
    this.#sentinel.prev = node;
  }

  get length(): number {
    return this.#length;
  }
}
