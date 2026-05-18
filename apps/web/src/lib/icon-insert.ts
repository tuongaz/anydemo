import { ICON_DEFAULT_SIZE } from '@seeflow/canvas';

export interface IconInsertRfInstance {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
}

export interface IconInsertViewport {
  width: number;
  height: number;
}

export interface IconInsertPayload {
  type: 'iconNode';
  position: { x: number; y: number };
  data: { icon: string; width: number; height: number };
}

/**
 * Compute the flow-space position for a new iconNode that should land visually
 * centered on the viewport. The result is the node's top-left corner — already
 * offset by half the default icon size so the node's center matches the
 * viewport center after React Flow positions it.
 */
export function computeIconInsertPosition(
  rfInstance: IconInsertRfInstance,
  viewport: IconInsertViewport,
): { x: number; y: number } {
  const center = rfInstance.screenToFlowPosition({
    x: viewport.width / 2,
    y: viewport.height / 2,
  });
  return {
    x: center.x - ICON_DEFAULT_SIZE.width / 2,
    y: center.y - ICON_DEFAULT_SIZE.height / 2,
  };
}

/**
 * Build the full iconNode create payload (type + position + data) for the
 * toolbar's insert-mode pick. Separates the math + shape construction from any
 * particular dispatcher, so the same payload is shared by demo-view's
 * onCreateIconNode call site and by the unit test.
 */
export function buildIconInsertPayload(args: {
  iconName: string;
  rfInstance: IconInsertRfInstance;
  viewport: IconInsertViewport;
}): IconInsertPayload {
  const position = computeIconInsertPosition(args.rfInstance, args.viewport);
  return {
    type: 'iconNode',
    position,
    data: {
      icon: args.iconName,
      width: ICON_DEFAULT_SIZE.width,
      height: ICON_DEFAULT_SIZE.height,
    },
  };
}
