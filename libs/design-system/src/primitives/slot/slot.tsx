import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react';

export interface SlotProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref != null) {
        (ref as { current: T | null }).current = value;
      }
    });
  };
}

function mergeProps(
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...slotProps };

  for (const key of Object.keys(childProps)) {
    const slotValue = slotProps[key];
    const childValue = childProps[key];

    if (key === 'style') {
      merged[key] = { ...(slotValue as object), ...(childValue as object) };
    } else if (key === 'className') {
      merged[key] = [slotValue, childValue].filter(Boolean).join(' ');
    } else if (key.startsWith('on') && typeof slotValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        if (typeof childValue === 'function') childValue(...args);
        (slotValue as (...args: unknown[]) => void)(...args);
      };
    } else {
      merged[key] = childValue !== undefined ? childValue : slotValue;
    }
  }

  return merged;
}

type AnyProps = Record<string, unknown>;

const Slot = forwardRef<HTMLElement, SlotProps>(function Slot(
  { children, ...slotProps },
  forwardedRef
) {
  const childArray = Children.toArray(children);
  const child = childArray[0];

  if (!isValidElement(child)) {
    return null;
  }

  const childElement = child as ReactElement<AnyProps> & {
    ref?: Ref<HTMLElement>;
  };
  const mergedProps = mergeProps(slotProps as AnyProps, childElement.props);

  if (forwardedRef) {
    mergedProps.ref = mergeRefs(forwardedRef, childElement.ref);
  } else if (childElement.ref) {
    mergedProps.ref = childElement.ref;
  }

  return cloneElement(childElement, mergedProps);
});

export { Slot };
