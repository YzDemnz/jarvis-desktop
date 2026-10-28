declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = any;
  export type Key = string | number;
  export type CSSProperties = Record<string, any>;
  export type ComponentType<P = any> = (props: P) => any;
  export type FC<P = any> = (props: P) => any;
  export interface RefObject<T> { readonly current: T | null }
  export interface MutableRefObject<T> { current: T }
  export type Ref<T> = RefObject<T> | ((v: T | null) => void) | null;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export interface SyntheticEvent<T = any> { target: any; currentTarget: T; preventDefault(): void; stopPropagation(): void }
  export interface ChangeEvent<T = any> { target: T & { value: string; checked: boolean }; currentTarget: T }
  export interface KeyboardEvent<T = any> {
    key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
    repeat: boolean; target: any; currentTarget: T; preventDefault(): void; stopPropagation(): void;
  }
  export interface MouseEvent<T = any> {
    clientX: number; clientY: number; button: number; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
    target: any; currentTarget: T; preventDefault(): void; stopPropagation(): void;
  }
  export interface WheelEvent<T = any> extends MouseEvent<T> { deltaY: number; deltaX: number }
  export interface FormEvent<T = any> { target: any; currentTarget: T; preventDefault(): void; stopPropagation(): void }
  export interface HTMLAttributes<T = any> { [k: string]: any }
  export interface ButtonHTMLAttributes<T = any> { [k: string]: any }
  export interface InputHTMLAttributes<T = any> { [k: string]: any }
  export interface TextareaHTMLAttributes<T = any> { [k: string]: any }
  export interface SVGProps<T = any> { [k: string]: any }
  export interface PropsWithChildren<P = unknown> { children?: ReactNode }
  export interface ErrorInfo { componentStack?: string | null; digest?: string | null }
  export class Component<P = {}, S = {}> {
    constructor(props: P);
    readonly props: Readonly<P> & { children?: ReactNode };
    state: Readonly<S>;
    setState(state: Partial<S> | ((prev: Readonly<S>, props: Readonly<P>) => Partial<S>), callback?: () => void): void;
    forceUpdate(callback?: () => void): void;
    render(): ReactNode;
  }
  export class PureComponent<P = {}, S = {}> extends Component<P, S> {}

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: readonly any[]): T;
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T>;
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  export function useReducer(reducer: any, initial: any, init?: any): [any, (a: any) => void];
  export function useId(): string;
  export function memo<T>(c: T): T;
  export function forwardRef<T, P>(render: (props: P, ref: Ref<T>) => any): (props: P & { ref?: Ref<T> }) => any;
  export function createElement(type: any, props?: any, ...children: any[]): any;
  export const Fragment: any;
  export const StrictMode: any;
  export interface CommonDOMProps {
    onClick?: (e: MouseEvent<any>) => void;
    onDoubleClick?: (e: MouseEvent<any>) => void;
    onAuxClick?: (e: MouseEvent<any>) => void;
    onMouseDown?: (e: MouseEvent<any>) => void;
    onMouseUp?: (e: MouseEvent<any>) => void;
    onMouseEnter?: (e: MouseEvent<any>) => void;
    onMouseLeave?: (e: MouseEvent<any>) => void;
    onMouseMove?: (e: MouseEvent<any>) => void;
    onContextMenu?: (e: MouseEvent<any>) => void;
    onWheel?: (e: WheelEvent<any>) => void;
    onKeyDown?: (e: KeyboardEvent<any>) => void;
    onKeyUp?: (e: KeyboardEvent<any>) => void;
    onKeyPress?: (e: KeyboardEvent<any>) => void;
    onChange?: (e: ChangeEvent<any>) => void;
    onInput?: (e: ChangeEvent<any>) => void;
    onSubmit?: (e: FormEvent<any>) => void;
    onFocus?: (e: FormEvent<any>) => void;
    onBlur?: (e: FormEvent<any>) => void;
    onScroll?: (e: FormEvent<any>) => void;
    onPointerDown?: (e: MouseEvent<any>) => void;
    onPointerMove?: (e: MouseEvent<any>) => void;
    onPointerUp?: (e: MouseEvent<any>) => void;
    ref?: any;
    key?: string | number | null;
    children?: ReactNode;
    [prop: string]: any;
  }
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' {
  import type { CommonDOMProps } from 'react';
  export namespace JSX {
    type Element = any;
    type ElementType = any;
    interface IntrinsicAttributes { key?: string | number | null | undefined }
    interface IntrinsicClassAttributes<T> { ref?: any }
    interface IntrinsicElements { [name: string]: CommonDOMProps }
    interface ElementChildrenAttribute { children: {} }
    interface ElementAttributesProperty { props: {} }
  }
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}
declare module 'react-dom/client' {
  export function createRoot(container: any): { render(node: any): void; unmount(): void };
}
