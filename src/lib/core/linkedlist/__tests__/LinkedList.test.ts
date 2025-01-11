import { Point } from "../../../geometry/point";
import { LinkedList } from "../LinkedList";
import { Node as PointNode } from "../Node";

describe("LinkedList", () => {
  let ll: LinkedList<Point>;
  beforeEach(() => {
    ll = new LinkedList();
  });

  describe("empty linked list", () => {
    it("should be zero and only contain the sentinel", () => {
      expect(ll.length).toBe(0);
      expect(ll.head).toBe(null);
      expect(ll.tail).toBe(null);
      expect(ll.sentinel.next).toBe(ll.sentinel);
      expect(ll.sentinel.prev).toBe(ll.sentinel);
    });
  });

  describe("insert at the end", () => {
    it("should maintain correct pointers when inserting one node", () => {
      const node = new PointNode(new Point(1, 2));
      ll.insertEnd(node);

      expect(ll.head).toBe(node);
      expect(ll.tail).toBe(node);
      expect(node.prev).toBe(ll.sentinel);
      expect(node.next).toBe(ll.sentinel);
      expect(ll.length).toBe(1);
    });

    it("should maintain correct pointers when inserting two node", () => {
      const node1 = new PointNode(new Point(1, 2));
      const node2 = new PointNode(new Point(3, 4));

      ll.insertEnd(node1);
      ll.insertEnd(node2);

      expect(ll.head).toBe(node1);
      expect(ll.tail).toBe(node2);

      expect(node1.next).toBe(node2);
      expect(node2.prev).toBe(node1);

      expect(ll.length).toBe(2);

      expect(node2.next).toBe(ll.sentinel);
      expect(node1.prev).toBe(ll.sentinel);
    });
  });

  describe("delete", () => {
    it("should maintain correct pointers when deleting one node from the end", () => {
      const node1 = new PointNode(new Point(1, 2));
      const node2 = new PointNode(new Point(3, 4));

      ll.insertEnd(node1);
      ll.insertEnd(node2);

      ll.delete(node2);

      expect(ll.tail).toBe(node1);
      expect(ll.head).toBe(node1);
      expect(ll.length).toBe(1);
    });
  });
});
