import { act, createRef, type Ref } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type PanelStorage,
  type ResizablePanelHandle,
} from "./Resizable";

if (typeof window !== "undefined" && typeof (window as any).PointerEvent === "undefined") {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: any = {}) {
      super(type, init);
      this.pointerId = init?.pointerId ?? 0;
    }
  }
  (window as any).PointerEvent = MockPointerEvent;
  (globalThis as any).PointerEvent = MockPointerEvent;
}

afterEach(cleanup);

describe("Resizable panel components (pixel-based)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders fixed-pixel sidebars and a flexible center panel", () => {
    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" />
        <ResizablePanel id="center" minSize={300} data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize right sidebar" inset="end" />
        <ResizablePanel
          id="right"
          defaultSize={260}
          minSize={180}
          maxSize={420}
          data-testid="right-panel"
        >
          <div>Right</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const left = screen.getByTestId("left-panel");
    const center = screen.getByTestId("center-panel");
    const right = screen.getByTestId("right-panel");

    expect(left.style.width).toBe("240px");
    expect(left.style.flexShrink).toBe("0");
    expect(right.style.width).toBe("260px");
    expect(right.style.flexShrink).toBe("0");
    expect(center.style.flex).toBe("1 1 0%");
  });

  it("supports imperative handle methods: getSize, resize, collapse, expand", () => {
    const leftRef = createRef<ResizablePanelHandle>();

    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          ref={leftRef}
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          collapsible
          collapsedSize={0}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" />
        <ResizablePanel id="center" data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const left = screen.getByTestId("left-panel");
    expect(leftRef.current?.getSize()).toBe(240);
    expect(leftRef.current?.isCollapsed()).toBe(false);
    expect(leftRef.current?.isExpanded()).toBe(true);

    // resize within bounds
    leftRef.current?.resize(300);
    expect(left.style.width).toBe("300px");
    expect(leftRef.current?.getSize()).toBe(300);

    // resize clamped to maxSize
    leftRef.current?.resize(500);
    expect(left.style.width).toBe("400px");
    expect(leftRef.current?.getSize()).toBe(400);

    // resize clamped to minSize
    leftRef.current?.resize(100);
    expect(left.style.width).toBe("160px");
    expect(leftRef.current?.getSize()).toBe(160);

    // collapse
    leftRef.current?.collapse();
    expect(left.style.width).toBe("0px");
    expect(leftRef.current?.isCollapsed()).toBe(true);
    expect(leftRef.current?.isExpanded()).toBe(false);

    // expand restores previous size
    leftRef.current?.expand();
    expect(left.style.width).toBe("160px");
    expect(leftRef.current?.isCollapsed()).toBe(false);
    expect(leftRef.current?.isExpanded()).toBe(true);
  });

  it("clamps non-collapsible panels to min size when resized below bounds", () => {
    const leftRef = createRef<ResizablePanelHandle>();

    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          ref={leftRef}
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" />
        <ResizablePanel id="center" data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const left = screen.getByTestId("left-panel");
    leftRef.current?.resize(0);

    expect(left.style.width).toBe("160px");
    expect(leftRef.current?.isCollapsed()).toBe(false);
  });

  it("resizes panels via pointer drag with pointer capture", () => {
    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" />
        <ResizablePanel id="center" data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
    const left = screen.getByTestId("left-panel");

    // mock pointer capture methods
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerEnter(handle);
    expect(handle.getAttribute("data-resize-handle-state")).toBe("hover");

    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(handle.getAttribute("data-resize-handle-state")).toBe("drag");

    fireEvent.pointerMove(handle, { clientX: 290, pointerId: 1 });
    expect(left.style.width).toBe("290px");

    fireEvent.pointerUp(handle, { clientX: 290, pointerId: 1 });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(handle.getAttribute("data-resize-handle-state")).toBe("hover");

    fireEvent.pointerLeave(handle);
    expect(handle.getAttribute("data-resize-handle-state")).toBe("idle");
  });

  it("resizes panels via keyboard arrow keys", () => {
    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" keyboardResizeBy={10} />
        <ResizablePanel id="center" data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
    const left = screen.getByTestId("left-panel");

    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(left.style.width).toBe("250px");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(left.style.width).toBe("240px");
  });

  it("triggers onDoubleClick handler on double-click", () => {
    const handleDoubleClick = vi.fn();

    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel id="left" defaultSize={240} data-testid="left-panel">
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" onDoubleClick={handleDoubleClick} />
        <ResizablePanel id="center">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
    fireEvent.doubleClick(handle);

    expect(handleDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("persists and restores panel sizes in localStorage with autoSaveId", () => {
    const autoSaveId = "test-layout";

    const { unmount } = render(
      <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId}>
        <ResizablePanel
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" />
        <ResizablePanel id="center">
          <div>Center</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize right sidebar" inset="end" />
        <ResizablePanel
          id="right"
          defaultSize={260}
          minSize={180}
          maxSize={420}
          data-testid="right-panel"
        >
          <div>Right</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 310, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 310, pointerId: 1 });

    expect(screen.getByTestId("left-panel").style.width).toBe("310px");

    unmount();

    // Render again with the same autoSaveId
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId}>
        <ResizablePanel
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          data-testid="left-panel-reloaded"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" />
        <ResizablePanel id="center">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    expect(screen.getByTestId("left-panel-reloaded").style.width).toBe("310px");
  });

  it("preserves expanded width persistence when a panel is collapsed", () => {
    const autoSaveId = "collapsed-layout";
    const leftRef = createRef<ResizablePanelHandle>();

    const { unmount } = render(
      <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId}>
        <ResizablePanel
          ref={leftRef}
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          collapsible
          collapsedSize={0}
          data-testid="left-panel"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" />
        <ResizablePanel id="center" data-testid="center-panel">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    leftRef.current?.resize(320);
    leftRef.current?.collapse();
    expect(screen.getByTestId("left-panel").style.width).toBe("0px");

    unmount();

    const leftRefReloaded = createRef<ResizablePanelHandle>();
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId}>
        <ResizablePanel
          ref={leftRefReloaded}
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          collapsible
          collapsedSize={0}
          data-testid="left-panel-reloaded"
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" />
        <ResizablePanel id="center">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );

    // Collapse does not overwrite persisted expanded width.
    expect(screen.getByTestId("left-panel-reloaded").style.width).toBe("320px");
    leftRefReloaded.current?.collapse();
    expect(screen.getByTestId("left-panel-reloaded").style.width).toBe("0px");
    leftRefReloaded.current?.expand();
    expect(screen.getByTestId("left-panel-reloaded").style.width).toBe("320px");
  });

  describe("robustness", () => {
    const sidebarLayout = (
      ref: Ref<ResizablePanelHandle>,
      options: { onResize?: () => void; autoSaveId?: string; storage?: PanelStorage } = {},
    ) => (
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId={options.autoSaveId}
        storage={options.storage}
      >
        <ResizablePanel
          ref={ref}
          id="left"
          defaultSize={240}
          minSize={160}
          maxSize={400}
          collapsible
          data-testid="left-panel"
          onResize={options.onResize}
        >
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize left sidebar" inset="start" />
        <ResizablePanel id="center">
          <div>Center</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );

    it("keeps a collapsed panel collapsed when the parent re-renders with new callbacks", () => {
      const ref = createRef<ResizablePanelHandle>();
      const { rerender } = render(sidebarLayout(ref, { onResize: () => {} }));

      act(() => ref.current?.collapse());
      expect(screen.getByTestId("left-panel").style.width).toBe("0px");

      rerender(sidebarLayout(ref, { onResize: () => {} }));

      expect(screen.getByTestId("left-panel").style.width).toBe("0px");
      expect(ref.current?.isCollapsed()).toBe(true);
    });

    it("keeps a resized panel at its size when the parent re-renders", () => {
      const ref = createRef<ResizablePanelHandle>();
      const { rerender } = render(sidebarLayout(ref));

      act(() => ref.current?.resize(333));
      rerender(sidebarLayout(ref));

      expect(screen.getByTestId("left-panel").style.width).toBe("333px");
      expect(ref.current?.getSize()).toBe(333);
    });

    it("reports resize callbacks from the latest props without re-registering the panel", () => {
      const ref = createRef<ResizablePanelHandle>();
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(sidebarLayout(ref, { onResize: first }));
      rerender(sidebarLayout(ref, { onResize: second }));

      act(() => ref.current?.resize(300));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(300, 240);
    });

    it("keeps data-panel-size and data-panel-collapsed in sync with imperative resizes", () => {
      const ref = createRef<ResizablePanelHandle>();
      render(sidebarLayout(ref));
      const panel = screen.getByTestId("left-panel");

      act(() => ref.current?.resize(300));
      expect(panel.getAttribute("data-panel-size")).toBe("300");
      expect(panel.hasAttribute("data-panel-collapsed")).toBe(false);

      act(() => ref.current?.collapse());
      expect(panel.getAttribute("data-panel-size")).toBe("0");
      expect(panel.hasAttribute("data-panel-collapsed")).toBe(true);

      act(() => ref.current?.expand());
      expect(panel.getAttribute("data-panel-size")).toBe("300");
      expect(panel.hasAttribute("data-panel-collapsed")).toBe(false);
    });

    it("applies min and max constraints when a collapsed panel expands", () => {
      const ref = createRef<ResizablePanelHandle>();
      render(sidebarLayout(ref));
      const panel = screen.getByTestId("left-panel");

      act(() => ref.current?.collapse());
      expect(panel.style.minWidth).toBe("0px");

      act(() => ref.current?.expand());
      expect(panel.style.minWidth).toBe("160px");
      expect(panel.style.maxWidth).toBe("400px");
    });

    it("reads persisted layout once instead of on every render", () => {
      const getItem = vi.fn(() => null);
      const storage: PanelStorage = { getItem, setItem: vi.fn() };
      const ref = createRef<ResizablePanelHandle>();
      const { rerender } = render(sidebarLayout(ref, { autoSaveId: "reads", storage }));
      const readsAfterMount = getItem.mock.calls.length;

      rerender(sidebarLayout(ref, { autoSaveId: "reads", storage }));
      rerender(sidebarLayout(ref, { autoSaveId: "reads", storage }));

      expect(readsAfterMount).toBe(1);
      expect(getItem.mock.calls.length).toBe(readsAfterMount);
    });

    it("never persists a collapsed panel as zero width", () => {
      const store = new Map<string, string>();
      const storage: PanelStorage = {
        getItem: (name) => store.get(name) ?? null,
        setItem: (name, value) => void store.set(name, value),
      };
      const ref = createRef<ResizablePanelHandle>();
      const { unmount } = render(sidebarLayout(ref, { autoSaveId: "no-zero", storage }));

      act(() => ref.current?.resize(320));
      act(() => ref.current?.collapse());
      unmount();

      const saved = JSON.parse(store.get("shift:resizable:no-zero") ?? "{}");
      expect(saved.sizes.left).toBe(320);
    });

    it("flushes an unsaved layout change when the group unmounts", () => {
      const setItem = vi.fn();
      const storage: PanelStorage = { getItem: () => null, setItem };
      const ref = createRef<ResizablePanelHandle>();
      const { unmount } = render(sidebarLayout(ref, { autoSaveId: "flush", storage }));
      expect(setItem).not.toHaveBeenCalled();

      act(() => ref.current?.collapse());
      unmount();

      expect(setItem).toHaveBeenCalledTimes(1);
    });

    it("exposes separator semantics for assistive technology", () => {
      const ref = createRef<ResizablePanelHandle>();
      render(sidebarLayout(ref));
      const handle = screen.getByRole("separator", { name: "Resize left sidebar" });

      expect(handle.getAttribute("aria-orientation")).toBe("vertical");
      expect(handle.getAttribute("aria-controls")).toBe("left");
      expect(handle.getAttribute("aria-valuenow")).toBe("240");
      expect(handle.getAttribute("aria-valuemin")).toBe("160");
      expect(handle.getAttribute("aria-valuemax")).toBe("400");

      act(() => ref.current?.resize(300));
      expect(handle.getAttribute("aria-valuenow")).toBe("300");
    });

    it("jumps to the min and max size with Home and End", () => {
      const ref = createRef<ResizablePanelHandle>();
      render(sidebarLayout(ref));
      const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
      const panel = screen.getByTestId("left-panel");

      fireEvent.keyDown(handle, { key: "End" });
      expect(panel.style.width).toBe("400px");

      fireEvent.keyDown(handle, { key: "Home" });
      expect(panel.style.width).toBe("160px");
    });

    it("ignores non-finite sizes instead of writing NaN to the layout", () => {
      const ref = createRef<ResizablePanelHandle>();
      const onResize = vi.fn();
      render(sidebarLayout(ref, { onResize }));
      const panel = screen.getByTestId("left-panel");

      act(() => ref.current?.resize(Number.NaN));
      act(() => ref.current?.resize(Number.POSITIVE_INFINITY));

      expect(panel.style.width).toBe("240px");
      expect(ref.current?.getSize()).toBe(240);
      expect(onResize).not.toHaveBeenCalled();
    });

    it("stops an active drag when its target panel unmounts", () => {
      const ref = createRef<ResizablePanelHandle>();
      const layout = (showLeft: boolean) => (
        <ResizablePanelGroup direction="horizontal">
          {showLeft ? (
            <ResizablePanel ref={ref} id="left" defaultSize={240} minSize={160} maxSize={400}>
              <div>Left</div>
            </ResizablePanel>
          ) : null}
          <ResizableHandle aria-label="Resize left sidebar" inset="start" />
          <ResizablePanel id="center" defaultSize={300}>
            <div>Center</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
      const { rerender } = render(layout(true));
      const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
      handle.setPointerCapture = vi.fn();
      fireEvent.pointerDown(handle, { clientX: 240, pointerId: 2 });

      rerender(layout(false));
      fireEvent.pointerMove(handle, { clientX: 300, pointerId: 2 });

      expect(handle.getAttribute("data-resize-handle-state")).not.toBe("drag");
    });

    it("marks a disabled handle as disabled for assistive technology", () => {
      render(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel id="left" defaultSize={240}>
            <div>Left</div>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize left sidebar" disabled />
          <ResizablePanel id="center">
            <div>Center</div>
          </ResizablePanel>
        </ResizablePanelGroup>,
      );

      expect(
        screen
          .getByRole("separator", { name: "Resize left sidebar" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });

    it("ends a drag and persists when pointer capture is lost", () => {
      const setItem = vi.fn();
      const storage: PanelStorage = { getItem: () => null, setItem };
      const ref = createRef<ResizablePanelHandle>();
      render(sidebarLayout(ref, { autoSaveId: "lost-capture", storage }));
      const handle = screen.getByRole("separator", { name: "Resize left sidebar" });
      handle.setPointerCapture = vi.fn();

      fireEvent.pointerDown(handle, { clientX: 240, pointerId: 4 });
      fireEvent.pointerMove(handle, { clientX: 280, pointerId: 4 });
      expect(handle.getAttribute("data-resize-handle-state")).toBe("drag");

      fireEvent.lostPointerCapture(handle, { pointerId: 4 });
      expect(handle.getAttribute("data-resize-handle-state")).not.toBe("drag");
      expect(setItem).toHaveBeenCalledTimes(1);

      fireEvent.pointerMove(handle, { clientX: 350, pointerId: 4 });
      expect(screen.getByTestId("left-panel").style.width).toBe("280px");
    });
  });
});

describe("Resizable layouts shared through autoSaveId", () => {
  const memoryStorage = (): PanelStorage => {
    const store = new Map<string, string>();

    return {
      getItem: (name) => store.get(name) ?? null,
      setItem: (name, value) => void store.set(name, value),
    };
  };

  const workspace = (
    ref: Ref<ResizablePanelHandle>,
    options: { autoSaveId: string; storage: PanelStorage; testId: string },
  ) => (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={options.autoSaveId}
      storage={options.storage}
    >
      <ResizablePanel
        ref={ref}
        id="left"
        defaultSize={240}
        minSize={160}
        maxSize={400}
        collapsible
        data-testid={options.testId}
      >
        <div>Left</div>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize left sidebar" inset="start" />
      <ResizablePanel id="center">
        <div>Center</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  const twoViews = (
    first: Ref<ResizablePanelHandle>,
    second: Ref<ResizablePanelHandle>,
    options: { storage: PanelStorage; secondAutoSaveId?: string; secondStorage?: PanelStorage },
  ) => (
    <>
      {workspace(first, { autoSaveId: "shared", storage: options.storage, testId: "home-left" })}
      {workspace(second, {
        autoSaveId: options.secondAutoSaveId ?? "shared",
        storage: options.secondStorage ?? options.storage,
        testId: "editor-left",
      })}
    </>
  );

  beforeEach(() => {
    localStorage.clear();
  });

  it("applies a width committed in one mounted group to the other", () => {
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    render(twoViews(home, editor, { storage: memoryStorage() }));

    act(() => editor.current?.resize(330));

    expect(screen.getByTestId("home-left").style.width).toBe("330px");
    expect(home.current?.getSize()).toBe(330);
    expect(screen.getByTestId("editor-left").style.width).toBe("330px");
  });

  it("syncs in both directions and keeps the latest width", () => {
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    render(twoViews(home, editor, { storage: memoryStorage() }));

    act(() => home.current?.resize(300));
    act(() => editor.current?.resize(350));
    act(() => home.current?.resize(280));

    expect(screen.getByTestId("editor-left").style.width).toBe("280px");
    expect(screen.getByTestId("home-left").style.width).toBe("280px");
  });

  it("syncs after a pointer drag ends", () => {
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    render(twoViews(home, editor, { storage: memoryStorage() }));
    const handle = screen.getAllByRole("separator", { name: "Resize left sidebar" })[1]!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 310, pointerId: 1 });
    expect(screen.getByTestId("home-left").style.width).toBe("240px");

    fireEvent.pointerUp(handle, { clientX: 310, pointerId: 1 });
    expect(screen.getByTestId("home-left").style.width).toBe("310px");
  });

  it("keeps a collapsed peer collapsed but re-opens it at the new width", () => {
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    render(twoViews(home, editor, { storage: memoryStorage() }));

    act(() => home.current?.collapse());
    act(() => editor.current?.resize(360));

    expect(screen.getByTestId("home-left").style.width).toBe("0px");
    expect(home.current?.isCollapsed()).toBe(true);

    act(() => home.current?.expand());
    expect(screen.getByTestId("home-left").style.width).toBe("360px");
  });

  it("clamps an adopted width to the receiving panel's own bounds", () => {
    const storage = memoryStorage();
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    render(
      <>
        <ResizablePanelGroup direction="horizontal" autoSaveId="shared" storage={storage}>
          <ResizablePanel ref={home} id="left" defaultSize={240} minSize={160} maxSize={300}>
            <div>Narrow</div>
          </ResizablePanel>
          <ResizablePanel id="center">
            <div>Center</div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {workspace(editor, { autoSaveId: "shared", storage, testId: "editor-left" })}
      </>,
    );

    act(() => editor.current?.resize(390));

    expect(home.current?.getSize()).toBe(300);
  });

  it("does not sync groups that use a different autoSaveId or a different storage", () => {
    const home = createRef<ResizablePanelHandle>();
    const otherKey = createRef<ResizablePanelHandle>();
    const { unmount } = render(
      twoViews(home, otherKey, { storage: memoryStorage(), secondAutoSaveId: "other" }),
    );
    act(() => otherKey.current?.resize(330));
    expect(screen.getByTestId("home-left").style.width).toBe("240px");
    unmount();

    const first = createRef<ResizablePanelHandle>();
    const second = createRef<ResizablePanelHandle>();
    render(twoViews(first, second, { storage: memoryStorage(), secondStorage: memoryStorage() }));
    act(() => second.current?.resize(330));
    expect(screen.getByTestId("home-left").style.width).toBe("240px");
  });

  it("stops notifying a group once it unmounts", () => {
    const storage = memoryStorage();
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    const { rerender } = render(twoViews(home, editor, { storage }));

    rerender(workspace(editor, { autoSaveId: "shared", storage, testId: "editor-left" }));

    expect(() => act(() => editor.current?.resize(330))).not.toThrow();
    expect(screen.getByTestId("editor-left").style.width).toBe("330px");
  });

  it("starts a newly mounted group from the layout the other group saved", () => {
    const storage = memoryStorage();
    const home = createRef<ResizablePanelHandle>();
    const editor = createRef<ResizablePanelHandle>();
    const { rerender } = render(
      workspace(home, { autoSaveId: "shared", storage, testId: "home-left" }),
    );
    act(() => home.current?.resize(320));

    rerender(twoViews(home, editor, { storage }));

    expect(screen.getByTestId("editor-left").style.width).toBe("320px");
  });
});
