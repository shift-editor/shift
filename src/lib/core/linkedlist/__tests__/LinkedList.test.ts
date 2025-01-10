import { Point } from "../../../geometry/point";
import { LinkedList } from "../LinkedList";
import { Node as PointNode } from "../Node";

describe("LinkedList", () => {
  describe("insert", () => {
    let ll: LinkedList<Point>;
    beforeEach(() => {
      ll = new LinkedList();
    });
    it("one node", () => {
      const node = new PointNode(new Point(1, 2));
      ll.insertEnd(node);

      expect(ll.tail).toBe(node);
      expect(ll.head).toBe(node);
      expect(ll.length).toBe(1);
    });
  });
});
