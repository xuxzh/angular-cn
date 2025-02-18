/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/**
 * @description
 *
 * Represents a type that a Component or other object is instances of.
 *
 * 表示 Component 或其他对象的类型。
 *
 * An example of a `Type` is `MyCustomComponent` class, which in JavaScript is represented by
 * the `MyCustomComponent` constructor function.
 *
 * `Type` 的例子之一是 `MyCustomComponent` 类，该类在 JavaScript 中由 `MyCustomComponent`
 * 构造函数表示。
 *
 * @publicApi
 */
export const Type = Function;

export function isType(v: any): v is Type<any> {
  return typeof v === 'function';
}

/**
 * @description
 *
 * Represents an abstract class `T`, if applied to a concrete class it would stop being
 * instantiable.
 *
 * 表示抽象类 `T`，如果将其应用于具体类，它将无法被实例化。
 *
 * @publicApi
 */
export interface AbstractType<T> extends Function {
  prototype: T;
}

export interface Type<T> extends Function {
  new(...args: any[]): T;
}

export type Mutable<T extends {[x: string]: any}, K extends string> = {
  [P in K]: T[P];
};

/**
 * Returns a writable type version of type.
 *
 * 返回 type 的可写类型版本。
 *
 * USAGE:
 * Given:
 *
 * 用法：给定：
 *
 * ```
 * interface Person {readonly name: string}
 * ```
 *
 * We would like to get a read/write version of `Person`.
 *
 * 我们希望获得 `Person` 的读/写版本。
 *
 * ```
 * const WritablePerson = Writable<Person>;
 * ```
 *
 * The result is that you can do:
 *
 * 结果是你可以这样做：
 *
 * ```
 * const readonlyPerson: Person = {name: 'Marry'};
 * readonlyPerson.name = 'John'; // TypeError
 * (readonlyPerson as WritablePerson).name = 'John'; // OK
 *
 * // Error: Correctly detects that `Person` did not have `age` property.
 * (readonlyPerson as WritablePerson).age = 30;
 * ```
 *
 */
export type Writable<T> = {
  -readonly[K in keyof T]: T[K];
};
