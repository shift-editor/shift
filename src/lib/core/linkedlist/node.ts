export class Node<T> {
  #prev: Node<T>;
  #next: Node<T>;

  #data?: T;

  constructor(data?: T) {
    this.#data = data;
    this.#prev = this;
    this.#next = this;
  }

  get prev(): Node<T> {
    return this.#prev;
  }

  set prev(node: Node<T>) {
    this.#prev = node;
  }

  set next(node: Node<T>) {
    this.#next = node;
  }

  get next(): Node<T> {
    return this.#next;
  }

  get data(): T | undefined {
    return this.#data;
  }
}
