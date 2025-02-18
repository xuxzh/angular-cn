/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {relativePathBetween} from '../../util/src/path';

/**
 * Rewrites imports of symbols being written into generated code.
 *
 * 重写正在写入生成代码的符号的导入。
 *
 */
export interface ImportRewriter {
  /**
   * Should the given symbol be imported at all?
   *
   * 给定的符号是否应该导入？
   *
   * If `true`, the symbol should be imported from the given specifier. If `false`, the symbol
   * should be referenced directly, without an import.
   *
   * 如果为 `true`，则应从给定的说明符导入符号。如果 `false`，则应直接引用该符号，而不需要导入。
   *
   */
  shouldImportSymbol(symbol: string, specifier: string): boolean;

  /**
   * Optionally rewrite a reference to an imported symbol, changing either the binding prefix or the
   * symbol name itself.
   *
   *（可选）重写对导入符号的引用，更改绑定前缀或符号名称本身。
   *
   */
  rewriteSymbol(symbol: string, specifier: string): string;

  /**
   * Optionally rewrite the given module specifier in the context of a given file.
   *
   *（可选）在给定文件的上下文中重写给定的模块说明符。
   *
   */
  rewriteSpecifier(specifier: string, inContextOfFile: string): string;
}

/**
 * `ImportRewriter` that does no rewriting.
 *
 * 不重写的 `ImportRewriter`。
 *
 */
export class NoopImportRewriter implements ImportRewriter {
  shouldImportSymbol(symbol: string, specifier: string): boolean {
    return true;
  }

  rewriteSymbol(symbol: string, specifier: string): string {
    return symbol;
  }

  rewriteSpecifier(specifier: string, inContextOfFile: string): string {
    return specifier;
  }
}

/**
 * A mapping of supported symbols that can be imported from within @angular/core, and the names by
 * which they're exported from r3_symbols.
 *
 * 可以从 @angular/core 中导入的受支持符号的映射，以及从 r3_symbols 导出它们的名称。
 *
 */
const CORE_SUPPORTED_SYMBOLS = new Map<string, string>([
  ['ɵɵdefineInjectable', 'ɵɵdefineInjectable'],
  ['ɵɵdefineInjector', 'ɵɵdefineInjector'],
  ['ɵɵdefineNgModule', 'ɵɵdefineNgModule'],
  ['ɵɵsetNgModuleScope', 'ɵɵsetNgModuleScope'],
  ['ɵɵinject', 'ɵɵinject'],
  ['ɵɵFactoryDeclaration', 'ɵɵFactoryDeclaration'],
  ['ɵsetClassMetadata', 'setClassMetadata'],
  ['ɵɵInjectableDeclaration', 'ɵɵInjectableDeclaration'],
  ['ɵɵInjectorDeclaration', 'ɵɵInjectorDeclaration'],
  ['ɵɵNgModuleDeclaration', 'ɵɵNgModuleDeclaration'],
  ['ɵNgModuleFactory', 'NgModuleFactory'],
  ['ɵnoSideEffects', 'ɵnoSideEffects'],
]);

const CORE_MODULE = '@angular/core';

/**
 * `ImportRewriter` that rewrites imports from '@angular/core' to be imported from the r3_symbols.ts
 * file instead.
 *
 * `ImportRewriter`，它将从 '@angular/core' 的导入重写为从 r3_symbols.ts 文件导入。
 *
 */
export class R3SymbolsImportRewriter implements ImportRewriter {
  constructor(private r3SymbolsPath: string) {}

  shouldImportSymbol(symbol: string, specifier: string): boolean {
    return true;
  }

  rewriteSymbol(symbol: string, specifier: string): string {
    if (specifier !== CORE_MODULE) {
      // This import isn't from core, so ignore it.
      return symbol;
    }

    return validateAndRewriteCoreSymbol(symbol);
  }

  rewriteSpecifier(specifier: string, inContextOfFile: string): string {
    if (specifier !== CORE_MODULE) {
      // This module isn't core, so ignore it.
      return specifier;
    }

    const relativePathToR3Symbols = relativePathBetween(inContextOfFile, this.r3SymbolsPath);
    if (relativePathToR3Symbols === null) {
      throw new Error(`Failed to rewrite import inside ${CORE_MODULE}: ${inContextOfFile} -> ${
          this.r3SymbolsPath}`);
    }

    return relativePathToR3Symbols;
  }
}

export function validateAndRewriteCoreSymbol(name: string): string {
  if (!CORE_SUPPORTED_SYMBOLS.has(name)) {
    throw new Error(`Importing unexpected symbol ${name} while compiling ${CORE_MODULE}`);
  }
  return CORE_SUPPORTED_SYMBOLS.get(name)!;
}
