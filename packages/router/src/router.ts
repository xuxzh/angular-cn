/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Location} from '@angular/common';
import {inject, Injectable, NgZone, Type, ɵConsole as Console, ɵInitialRenderPendingTasks as InitialRenderPendingTasks, ɵRuntimeError as RuntimeError} from '@angular/core';
import {Observable, of, SubscriptionLike} from 'rxjs';

import {createSegmentGroupFromRoute, createUrlTreeFromSegmentGroup} from './create_url_tree';
import {INPUT_BINDER} from './directives/router_outlet';
import {RuntimeErrorCode} from './errors';
import {Event, IMPERATIVE_NAVIGATION, NavigationTrigger} from './events';
import {NavigationBehaviorOptions, OnSameUrlNavigation, Routes} from './models';
import {Navigation, NavigationExtras, NavigationTransition, NavigationTransitions, RestoredState, UrlCreationOptions} from './navigation_transition';
import {TitleStrategy} from './page_title_strategy';
import {RouteReuseStrategy} from './route_reuse_strategy';
import {ROUTER_CONFIGURATION} from './router_config';
import {ROUTES} from './router_config_loader';
import {createEmptyState, RouterState} from './router_state';
import {Params} from './shared';
import {UrlHandlingStrategy} from './url_handling_strategy';
import {containsTree, IsActiveMatchOptions, isUrlTree, UrlSegmentGroup, UrlSerializer, UrlTree} from './url_tree';
import {standardizeConfig, validateConfig} from './utils/config';
import {afterNextNavigation} from './utils/navigations';



function defaultErrorHandler(error: any): any {
  throw error;
}

function defaultMalformedUriErrorHandler(
    error: URIError, urlSerializer: UrlSerializer, url: string): UrlTree {
  return urlSerializer.parse('/');
}

/**
 * The equivalent `IsActiveMatchOptions` options for `Router.isActive` is called with `true`
 * \(exact = true\).
 *
 * `Router.isActive` 的等效 `IsActiveMatchOptions` 选项使用 `true` \(exact = true\) 调用。
 *
 */
export const exactMatchOptions: IsActiveMatchOptions = {
  paths: 'exact',
  fragment: 'ignored',
  matrixParams: 'ignored',
  queryParams: 'exact'
};

/**
 * The equivalent `IsActiveMatchOptions` options for `Router.isActive` is called with `false`
 * \(exact = false\).
 *
 * `Router.isActive` 的等效 `IsActiveMatchOptions` 选项使用 `false` \(exact = false\) 调用。
 *
 */
export const subsetMatchOptions: IsActiveMatchOptions = {
  paths: 'subset',
  fragment: 'ignored',
  matrixParams: 'ignored',
  queryParams: 'subset'
};

/**
 * @description
 *
 * A service that provides navigation among views and URL manipulation capabilities.
 *
 * 一个提供导航和操纵 URL 能力的 NgModule。
 * @see `Route`.
 * @see [Routing and Navigation Guide](guide/router).
 *
 * [路由和导航指南](guide/router)。
 * @ngModule RouterModule
 * @publicApi
 */
@Injectable({providedIn: 'root'})
export class Router {
  /**
   * Represents the activated `UrlTree` that the `Router` is configured to handle \(through
   * `UrlHandlingStrategy`\). That is, after we find the route config tree that we're going to
   * activate, run guards, and are just about to activate the route, we set the currentUrlTree.
   *
   * 表示 `Router` 配置为处理（通过 `UrlHandlingStrategy` ）的已激活 `UrlTree`。也就是说，在我们找到要激活的路由配置树后，运行守卫，并且即将激活路由，我们设置 currentUrlTree。
   *
   * This should match the `browserUrlTree` when a navigation succeeds. If the
   * `UrlHandlingStrategy.shouldProcessUrl` is `false`, only the `browserUrlTree` is updated.
   *
   * 当导航成功时，这应该与 `browserUrlTree` 匹配。如果 `UrlHandlingStrategy.shouldProcessUrl` 为 `false`，则仅更新 `browserUrlTree`。
   *
   * @internal
   */
  currentUrlTree: UrlTree;
  /**
   * Meant to represent the entire browser url after a successful navigation. In the life of a
   * navigation transition:
   *
   * 意味着在成功导航后代表整个浏览器 url。在导航过渡的生活中：
   *
   * 1. The rawUrl represents the full URL that's being navigated to
   *
   *    rawUrl 表示要导航到的完整 URL
   *
   * 2. We apply redirects, which might only apply to _part_ of the URL \(due to
   *    `UrlHandlingStrategy`\).
   *
   *    我们应用重定向，这可能只适用于\_ 部分\_URL（由于 `UrlHandlingStrategy` ）。
   *
   * 3. Right before activation \(because we assume activation will succeed\), we update the
   *    rawUrlTree to be a combination of the urlAfterRedirects \(again, this might only apply to part
   *    of the initial url\) and the rawUrl of the transition \(which was the original navigation url in
   *    its full form\).
   *
   *    在激活之前（因为我们假设激活会成功），我们将 rawUrlTree 更新为 urlAfterRedirects（同样，这可能只适用于部分初始 url）和转换的 rawUrl（这是原始导航 url）的组合完整形式）。
   *
   * @internal
   *
   * Note that this is _only_ here to support `UrlHandlingStrategy.extract` and
   * `UrlHandlingStrategy.shouldProcessUrl`. If those didn't exist, we could get by with
   * `currentUrlTree` alone. If a new Router were to be provided (i.e. one that works with the
   * browser navigation API), we should think about whether this complexity should be carried over.
   *
   * - extract: `rawUrlTree` is needed because `extract` may only return part
   * of the navigation URL. Thus, `currentUrlTree` may only represent _part_ of the browser URL.
   * When a navigation gets cancelled and we need to reset the URL or a new navigation occurs, we
   * need to know the _whole_ browser URL, not just the part handled by UrlHandlingStrategy.
   * - shouldProcessUrl: When this returns `false`, the router just ignores the navigation but still
   * updates the `rawUrlTree` with the assumption that the navigation was caused by the location
   * change listener due to a URL update by the AngularJS router. In this case, we still need to
   * know what the browser's URL is for future navigations.
   */
  rawUrlTree: UrlTree;
  /**
   * Meant to represent the part of the browser url that the `Router` is set up to handle \(via the
   * `UrlHandlingStrategy`\). This value is updated immediately after the browser url is updated \(or
   * the browser url update is skipped via `skipLocationChange`\). With that, note that
   * `browserUrlTree` _may not_ reflect the actual browser URL for two reasons:
   *
   * 意味着表示 `Router` 设置为处理的浏览器 url 部分（通过 `UrlHandlingStrategy` ）。该值在浏览器 url 更新后立即更新（或通过 `skipLocationChange` 跳过浏览器 url 更新）。因此，请注意 `browserUrlTree`_ 可能不会 _ 反映实际的浏览器 URL，原因有两个：
   *
   * 1. `UrlHandlingStrategy` only handles part of the URL
   *
   *    `UrlHandlingStrategy` 只处理部分 URL
   *
   * 2. `skipLocationChange` does not update the browser url.
   *
   *    `skipLocationChange` 不会更新浏览器 url。
   *
   * So to reiterate, `browserUrlTree` only represents the Router's internal understanding of the
   * current route, either before guards with `urlUpdateStrategy === 'eager'` or right before
   * activation with `'deferred'`.
   *
   * 因此，重申一下，`browserUrlTree` 仅代表路由器对当前路由的内部理解，要么在 `urlUpdateStrategy === 'eager'` 守卫之前，要么在使用 `'deferred'` 激活之前。
   *
   * This should match the `currentUrlTree` when the navigation succeeds.
   *
   * 当导航成功时，这应该与 `currentUrlTree` 匹配。
   *
   * @internal
   */
  browserUrlTree: UrlTree;
  private disposed = false;

  private locationSubscription?: SubscriptionLike;
  // TODO(b/260747083): This should not exist and navigationId should be private in
  // `NavigationTransitions`
  private get navigationId() {
    return this.navigationTransitions.navigationId;
  }

  /**
   * The id of the currently active page in the router.
   * Updated to the transition's target id on a successful navigation.
   *
   * This is used to track what page the router last activated. When an attempted navigation fails,
   * the router can then use this to compute how to restore the state back to the previously active
   * page.
   */
  private currentPageId: number = 0;
  /**
   * The ɵrouterPageId of whatever page is currently active in the browser history. This is
   * important for computing the target page id for new navigations because we need to ensure each
   * page id in the browser history is 1 more than the previous entry.
   */
  private get browserPageId(): number|undefined {
    if (this.canceledNavigationResolution !== 'computed') {
      return undefined;
    }
    return (this.location.getState() as RestoredState | null)?.ɵrouterPageId;
  }
  private console = inject(Console);
  private isNgZoneEnabled: boolean = false;

  /**
   * An event stream for routing events.
   *
   * 用于路由事件的事件流。
   *
   */
  public get events(): Observable<Event> {
    // TODO(atscott): This _should_ be events.asObservable(). However, this change requires internal
    // cleanup: tests are doing `(route.events as Subject<Event>).next(...)`. This isn't
    // allowed/supported but we still have to fix these or file bugs against the teams before making
    // the change.
    return this.navigationTransitions.events;
  }
  /**
   * The current state of routing in this NgModule.
   *
   * 此 NgModule 中路由的当前状态。
   *
   */
  public readonly routerState: RouterState;

  private options = inject(ROUTER_CONFIGURATION, {optional: true}) || {};

  private pendingTasks = inject(InitialRenderPendingTasks);

  /**
   * A handler for navigation errors in this NgModule.
   *
   * 本模块中的导航错误处理器。
   *
   * @deprecated
   *
   * Subscribe to the `Router` events and watch for `NavigationError` instead.
   *   `provideRouter` has the `withNavigationErrorHandler` feature to make this easier.
   *
   * 订阅 `Router` 事件并观察 `NavigationError`。`provideRouter` 具有 `withNavigationErrorHandler` 功能，使这更容易。
   *
   * @see `withNavigationErrorHandler`
   */
  errorHandler = this.options.errorHandler || defaultErrorHandler;

  /**
   * A handler for errors thrown by `Router.parseUrl(url)`
   * when `url` contains an invalid character.
   * The most common case is a `%` sign
   * that's not encoded and is not part of a percent encoded sequence.
   *
   * uri 格式无效错误的处理器，在 `Router.parseUrl(url)` 由于 `url` 包含无效字符而报错时调用。最常见的情况可能是 `%` 本身既没有被编码，又不是正常 `%` 编码序列的一部分。
   *
   * @deprecated
   *
   * URI parsing errors should be handled in the `UrlSerializer`.
   *
   * URI 解析错误应该在 `UrlSerializer` 中处理。
   *
   * @see `RouterModule`
   */
  malformedUriErrorHandler =
      this.options.malformedUriErrorHandler || defaultMalformedUriErrorHandler;

  /**
   * True if at least one navigation event has occurred,
   * false otherwise.
   *
   * 如果为 True 则表示是否发生过至少一次导航，反之为 False。
   *
   */
  navigated: boolean = false;
  private lastSuccessfulId: number = -1;

  /**
   * A strategy for extracting and merging URLs.
   * Used for AngularJS to Angular migrations.
   *
   * 提取并合并 URL。在 AngularJS 向 Angular 迁移时会用到。
   *
   * @deprecated
   *
   * Configure using `providers` instead:
   *   `{provide: UrlHandlingStrategy, useClass: MyStrategy}`.
   *
   * 改为使用 `providers` 进行配置：`{provide: UrlHandlingStrategy, useClass: MyStrategy}`。
   *
   */
  urlHandlingStrategy = inject(UrlHandlingStrategy);

  /**
   * A strategy for re-using routes.
   *
   * 复用路由的策略。
   *
   * @deprecated
   *
   * Configure using `providers` instead:
   *   `{provide: RouteReuseStrategy, useClass: MyStrategy}`.
   *
   * 改为使用 `providers` 进行配置：`{provide: RouteReuseStrategy, useClass: MyStrategy}`。
   *
   */
  routeReuseStrategy = inject(RouteReuseStrategy);

  /**
   * A strategy for setting the title based on the `routerState`.
   *
   * 根据 `routerState` 设置标题的策略。
   *
   * @deprecated
   *
   * Configure using `providers` instead:
   *   `{provide: TitleStrategy, useClass: MyStrategy}`.
   *
   * 改为使用 `providers` 进行配置：`{provide: TitleStrategy, useClass: MyStrategy}`。
   *
   */
  titleStrategy?: TitleStrategy = inject(TitleStrategy);

  /**
   * How to handle a navigation request to the current URL.
   *
   * 如何处理对当前 URL 的导航请求。
   *
   * @deprecated
   *
   * Configure this through `provideRouter` or `RouterModule.forRoot` instead.
   *
   * 通过 `provideRouter` 或 `RouterModule.forRoot` 配置它。
   *
   * @see `withRouterConfig`
   * @see `provideRouter`
   * @see `RouterModule`
   */
  onSameUrlNavigation: OnSameUrlNavigation = this.options.onSameUrlNavigation || 'ignore';

  /**
   * How to merge parameters, data, resolved data, and title from parent to child
   * routes. One of:
   *
   * 如何从父路由向子路由合并参数、数据和解析到的数据。可取下列值之一：
   *
   * - `'emptyOnly'` : Inherit parent parameters, data, and resolved data
   *   for path-less or component-less routes.
   *
   *   `'emptyOnly'`：让无路径或无组件的路由继承父级的参数、数据和解析到的数据。
   *
   * - `'always'` : Inherit parent parameters, data, and resolved data
   *   for all child routes.
   *
   *   `'always'`：让所有子路由都继承父级的参数、数据和解析到的数据。
   *
   * @deprecated
   *
   * Configure this through `provideRouter` or `RouterModule.forRoot` instead.
   *
   * 通过 `provideRouter` 或 `RouterModule.forRoot` 配置它。
   *
   * @see `withRouterConfig`
   * @see `provideRouter`
   * @see `RouterModule`
   */
  paramsInheritanceStrategy: 'emptyOnly'|'always' =
      this.options.paramsInheritanceStrategy || 'emptyOnly';

  /**
   * Determines when the router updates the browser URL.
   * By default \(`"deferred"`\), updates the browser URL after navigation has finished.
   * Set to `'eager'` to update the browser URL at the beginning of navigation.
   * You can choose to update early so that, if navigation fails,
   * you can show an error message with the URL that failed.
   *
   * 确定路由器何时更新浏览器 URL。默认情况下（`"deferred"`）在导航完成后更新浏览器 URL。设置为 `'eager'` 可以在浏览开始时更新浏览器 URL。你可以选择早期更新，这样，如果导航失败，则可以显示带有失败 URL 的错误消息。
   *
   * @deprecated
   *
   * Configure this through `provideRouter` or `RouterModule.forRoot` instead.
   *
   * 通过 `provideRouter` 或 `RouterModule.forRoot` 配置它。
   *
   * @see `withRouterConfig`
   * @see `provideRouter`
   * @see `RouterModule`
   */
  urlUpdateStrategy: 'deferred'|'eager' = this.options.urlUpdateStrategy || 'deferred';

  /**
   * Configures how the Router attempts to restore state when a navigation is cancelled.
   *
   * 配置在取消导航时路由器如何尝试恢复状态。
   *
   * 'replace' - Always uses `location.replaceState` to set the browser state to the state of the
   * router before the navigation started. This means that if the URL of the browser is updated
   * _before_ the navigation is canceled, the Router will simply replace the item in history rather
   * than trying to restore to the previous location in the session history. This happens most
   * frequently with `urlUpdateStrategy: 'eager'` and navigations with the browser back/forward
   * buttons.
   *
   * 'replace' - 始终使用 `location.replaceState` 将浏览器状态设置为导航开始前的路由器状态。这意味着如果浏览器的 URL 在取消导航 _ 之前 _ 更新，则路由器将简单地替换历史记录中的项目，而不是尝试恢复到会话历史记录中的先前位置。这种情况最常发生在 `urlUpdateStrategy: 'eager'` 和使用浏览器后退/前进按钮的导航中。
   *
   * 'computed' - Will attempt to return to the same index in the session history that corresponds
   * to the Angular route when the navigation gets cancelled. For example, if the browser back
   * button is clicked and the navigation is cancelled, the Router will trigger a forward navigation
   * and vice versa.
   *
   * “comped” - 当导航被取消时，将尝试返回会话历史记录中与 Angular 路由对应的同一个索引。例如，如果单击浏览器后退按钮并取消导航，则路由器将触发向前导航，反之亦然。
   *
   * Note: the 'computed' option is incompatible with any `UrlHandlingStrategy` which only
   * handles a portion of the URL because the history restoration navigates to the previous place in
   * the browser history rather than simply resetting a portion of the URL.
   *
   * 注意：' `UrlHandlingStrategy` ' 选项与任何仅处理一部分 URL 的 UrlHandlingStrategy 不兼容，因为历史恢复会导航到浏览器历史记录中的上一个位置，而不是简单地重置 URL 的一部分。
   *
   * The default value is `replace`.
   *
   * 默认值是 `replace`。
   *
   * @deprecated
   *
   * Configure this through `provideRouter` or `RouterModule.forRoot` instead.
   *
   * 通过 `provideRouter` 或 `RouterModule.forRoot` 配置它。
   *
   * @see `withRouterConfig`
   * @see `provideRouter`
   * @see `RouterModule`
   */
  canceledNavigationResolution: 'replace'|'computed' =
      this.options.canceledNavigationResolution || 'replace';

  config: Routes = inject(ROUTES, {optional: true})?.flat() ?? [];

  private readonly navigationTransitions = inject(NavigationTransitions);
  private readonly urlSerializer = inject(UrlSerializer);
  private readonly location = inject(Location);

  /**
   * Indicates whether the the application has opted in to binding Router data to component inputs.
   *
   * 指示应用程序是否已选择将路由器数据绑定到组件输入。
   *
   * This option is enabled by the `withComponentInputBinding` feature of `provideRouter` or
   * `bindToComponentInputs` in the `ExtraOptions` of `RouterModule.forRoot`.
   *
   * 此选项由 `provideRouter` 的 `withComponentInputBinding` 功能或 `RouterModule.forRoot` 的 `ExtraOptions` 中的 `bindToComponentInputs` 启用。
   *
   */
  readonly componentInputBindingEnabled = !!inject(INPUT_BINDER, {optional: true});

  constructor() {
    this.isNgZoneEnabled = inject(NgZone) instanceof NgZone && NgZone.isInAngularZone();

    this.resetConfig(this.config);
    this.currentUrlTree = new UrlTree();
    this.rawUrlTree = this.currentUrlTree;
    this.browserUrlTree = this.currentUrlTree;

    this.routerState = createEmptyState(this.currentUrlTree, null);

    this.navigationTransitions.setupNavigations(this).subscribe(
        t => {
          this.lastSuccessfulId = t.id;
          this.currentPageId = this.browserPageId ?? 0;
        },
        e => {
          this.console.warn(`Unhandled Navigation Error: ${e}`);
        });
  }

  /** @internal */
  resetRootComponentType(rootComponentType: Type<any>): void {
    // TODO: vsavkin router 4.0 should make the root component set to null
    // this will simplify the lifecycle of the router.
    this.routerState.root.component = rootComponentType;
    this.navigationTransitions.rootComponentType = rootComponentType;
  }

  /**
   * Sets up the location change listener and performs the initial navigation.
   *
   * 设置位置变化监听器，并执行首次导航。
   *
   */
  initialNavigation(): void {
    this.setUpLocationChangeListener();
    if (!this.navigationTransitions.hasRequestedNavigation) {
      const state = this.location.getState() as RestoredState;
      this.navigateToSyncWithBrowser(this.location.path(true), IMPERATIVE_NAVIGATION, state);
    }
  }

  /**
   * Sets up the location change listener. This listener detects navigations triggered from outside
   * the Router \(the browser back/forward buttons, for example\) and schedules a corresponding Router
   * navigation so that the correct events, guards, etc. are triggered.
   *
   * 设置 location 更改监听器。该监听器检测从路由器外部触发的导航（比如，浏览器的后退/前进按钮），并安排相应的路由器导航，以便触发正确的事件、守卫等。
   *
   */
  setUpLocationChangeListener(): void {
    // Don't need to use Zone.wrap any more, because zone.js
    // already patch onPopState, so location change callback will
    // run into ngZone
    if (!this.locationSubscription) {
      this.locationSubscription = this.location.subscribe(event => {
        const source = event['type'] === 'popstate' ? 'popstate' : 'hashchange';
        if (source === 'popstate') {
          // The `setTimeout` was added in #12160 and is likely to support Angular/AngularJS
          // hybrid apps.
          setTimeout(() => {
            this.navigateToSyncWithBrowser(event['url']!, source, event.state);
          }, 0);
        }
      });
    }
  }

  /**
   * Schedules a router navigation to synchronize Router state with the browser state.
   *
   * This is done as a response to a popstate event and the initial navigation. These
   * two scenarios represent times when the browser URL/state has been updated and
   * the Router needs to respond to ensure its internal state matches.
   */
  private navigateToSyncWithBrowser(
      url: string, source: NavigationTrigger, state: RestoredState|undefined) {
    const extras: NavigationExtras = {replaceUrl: true};

    // TODO: restoredState should always include the entire state, regardless
    // of navigationId. This requires a breaking change to update the type on
    // NavigationStart’s restoredState, which currently requires navigationId
    // to always be present. The Router used to only restore history state if
    // a navigationId was present.

    // The stored navigationId is used by the RouterScroller to retrieve the scroll
    // position for the page.
    const restoredState = state?.navigationId ? state : null;

    // Separate to NavigationStart.restoredState, we must also restore the state to
    // history.state and generate a new navigationId, since it will be overwritten
    if (state) {
      const stateCopy = {...state} as Partial<RestoredState>;
      delete stateCopy.navigationId;
      delete stateCopy.ɵrouterPageId;
      if (Object.keys(stateCopy).length !== 0) {
        extras.state = stateCopy;
      }
    }

    const urlTree = this.parseUrl(url);
    this.scheduleNavigation(urlTree, source, restoredState, extras);
  }

  /**
   * The current URL.
   *
   * 当前 URL。
   *
   */
  get url(): string {
    return this.serializeUrl(this.currentUrlTree);
  }

  /**
   * Returns the current `Navigation` object when the router is navigating,
   * and `null` when idle.
   *
   * 路由器正在导航时返回当前的 `Navigation` 对象，空闲时返回 `null`。
   *
   */
  getCurrentNavigation(): Navigation|null {
    return this.navigationTransitions.currentNavigation;
  }

  /**
   * The `Navigation` object of the most recent navigation to succeed and `null` if there
   *     has not been a successful navigation yet.
   *
   * 最近一次成功导航的 `Navigation` 对象，如果还没有成功导航则为 `null`。
   *
   */
  get lastSuccessfulNavigation(): Navigation|null {
    return this.navigationTransitions.lastSuccessfulNavigation;
  }

  /**
   * Resets the route configuration used for navigation and generating links.
   *
   * 重置供导航和生成链接使用的配置项。
   *
   * @param config The route array for the new configuration.
   *
   * 新配置中的路由定义数组。
   *
   * @usageNotes
   *
   * ```
   * router.resetConfig([
   *  { path: 'team/:id', component: TeamCmp, children: [
   *    { path: 'simple', component: SimpleCmp },
   *    { path: 'user/:name', component: UserCmp }
   *  ]}
   * ]);
   * ```
   */
  resetConfig(config: Routes): void {
    (typeof ngDevMode === 'undefined' || ngDevMode) && validateConfig(config);
    this.config = config.map(standardizeConfig);
    this.navigated = false;
    this.lastSuccessfulId = -1;
  }

  /** @nodoc */
  ngOnDestroy(): void {
    this.dispose();
  }

  /**
   * Disposes of the router.
   *
   * 销毁路由器。
   *
   */
  dispose(): void {
    this.navigationTransitions.complete();
    if (this.locationSubscription) {
      this.locationSubscription.unsubscribe();
      this.locationSubscription = undefined;
    }
    this.disposed = true;
  }

  /**
   * Appends URL segments to the current URL tree to create a new URL tree.
   *
   * 将 URL 段添加到当前 URL 树中以创建新的 URL 树。
   *
   * @param commands An array of URL fragments with which to construct the new URL tree.
   * If the path is static, can be the literal URL string. For a dynamic path, pass an array of path
   * segments, followed by the parameters for each segment.
   * The fragments are applied to the current URL tree or the one provided  in the `relativeTo`
   * property of the options object, if supplied.
   *
   * 一个 URL 段的数组，用于构造新的 URL 树。如果此路径是静态的，则可能是 URL 字符串字面量。对于动态路径，可以传入一个路径段的数组，后跟每个段的参数。这些段会应用到当前 URL 树上，或者在选项对象中的 `relativeTo` 属性上（如果有）。
   * @param navigationExtras Options that control the navigation strategy.
   *
   * 控制导航策略的选项。
   * @returns
   *
   * The new URL tree.
   *
   * 新的 URL 树。
   *
   * @usageNotes
   *
   * ```
   * // create /team/33/user/11
   * router.createUrlTree(['/team', 33, 'user', 11]);
   *
   * // create /team/33;expand=true/user/11
   * router.createUrlTree(['/team', 33, {expand: true}, 'user', 11]);
   *
   * // you can collapse static segments like this (this works only with the first passed-in value):
   * router.createUrlTree(['/team/33/user', userId]);
   *
   * // If the first segment can contain slashes, and you do not want the router to split it,
   * // you can do the following:
   * router.createUrlTree([{segmentPath: '/one/two'}]);
   *
   * // create /team/33/(user/11//right:chat)
   * router.createUrlTree(['/team', 33, {outlets: {primary: 'user/11', right: 'chat'}}]);
   *
   * // remove the right secondary node
   * router.createUrlTree(['/team', 33, {outlets: {primary: 'user/11', right: null}}]);
   *
   * // assuming the current url is `/team/33/user/11` and the route points to `user/11`
   *
   * // navigate to /team/33/user/11/details
   * router.createUrlTree(['details'], {relativeTo: route});
   *
   * // navigate to /team/33/user/22
   * router.createUrlTree(['../22'], {relativeTo: route});
   *
   * // navigate to /team/44/user/22
   * router.createUrlTree(['../../team/44/user/22'], {relativeTo: route});
   *
   * Note that a value of `null` or `undefined` for `relativeTo` indicates that the
   * tree should be created relative to the root.
   * ```
   */
  createUrlTree(commands: any[], navigationExtras: UrlCreationOptions = {}): UrlTree {
    const {relativeTo, queryParams, fragment, queryParamsHandling, preserveFragment} =
        navigationExtras;
    const f = preserveFragment ? this.currentUrlTree.fragment : fragment;
    let q: Params|null = null;
    switch (queryParamsHandling) {
      case 'merge':
        q = {...this.currentUrlTree.queryParams, ...queryParams};
        break;
      case 'preserve':
        q = this.currentUrlTree.queryParams;
        break;
      default:
        q = queryParams || null;
    }
    if (q !== null) {
      q = this.removeEmptyProps(q);
    }

    let relativeToUrlSegmentGroup: UrlSegmentGroup|undefined;
    try {
      const relativeToSnapshot = relativeTo ? relativeTo.snapshot : this.routerState.snapshot.root;
      relativeToUrlSegmentGroup = createSegmentGroupFromRoute(relativeToSnapshot);
    } catch (e: unknown) {
      // This is strictly for backwards compatibility with tests that create
      // invalid `ActivatedRoute` mocks.
      // Note: the difference between having this fallback for invalid `ActivatedRoute` setups and
      // just throwing is ~500 test failures. Fixing all of those tests by hand is not feasible at
      // the moment.
      if (typeof commands[0] !== 'string' || !commands[0].startsWith('/')) {
        // Navigations that were absolute in the old way of creating UrlTrees
        // would still work because they wouldn't attempt to match the
        // segments in the `ActivatedRoute` to the `currentUrlTree` but
        // instead just replace the root segment with the navigation result.
        // Non-absolute navigations would fail to apply the commands because
        // the logic could not find the segment to replace (so they'd act like there were no
        // commands).
        commands = [];
      }
      relativeToUrlSegmentGroup = this.currentUrlTree.root;
    }
    return createUrlTreeFromSegmentGroup(relativeToUrlSegmentGroup, commands, q, f ?? null);
  }

  /**
   * Navigates to a view using an absolute route path.
   *
   * 基于所提供的 URL 进行导航，必须使用绝对路径。
   *
   * @param url An absolute path for a defined route. The function does not apply any delta to the
   *     current URL.
   *
   * 一个绝对 URL。该函数不会对当前 URL 做任何修改。
   * @param extras An object containing properties that modify the navigation strategy.
   *
   * 一个包含一组属性的对象，它会修改导航策略。
   * @returns
   *
   * A Promise that resolves to 'true' when navigation succeeds,
   * to 'false' when navigation fails, or is rejected on error.
   *
   * 一个 Promise，当导航成功时解析为“true”，当导航失败时解析为“false”，或者因错误而被拒绝。
   *
   * @usageNotes
   *
   * The following calls request navigation to an absolute path.
   *
   * 以下调用要求导航到绝对路径。
   *
   * ```
   * router.navigateByUrl("/team/33/user/11");
   *
   * // Navigate without updating the URL
   * router.navigateByUrl("/team/33/user/11", { skipLocationChange: true });
   * ```
   * @see [Routing and Navigation guide](guide/router)
   *
   * [路由和导航指南](guide/router)
   */
  navigateByUrl(url: string|UrlTree, extras: NavigationBehaviorOptions = {
    skipLocationChange: false
  }): Promise<boolean> {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      if (this.isNgZoneEnabled && !NgZone.isInAngularZone()) {
        this.console.warn(
            `Navigation triggered outside Angular zone, did you forget to call 'ngZone.run()'?`);
      }
    }

    const urlTree = isUrlTree(url) ? url : this.parseUrl(url);
    const mergedTree = this.urlHandlingStrategy.merge(urlTree, this.rawUrlTree);

    return this.scheduleNavigation(mergedTree, IMPERATIVE_NAVIGATION, null, extras);
  }

  /**
   * Navigate based on the provided array of commands and a starting point.
   * If no starting route is provided, the navigation is absolute.
   *
   * 基于所提供的命令数组和起点路由进行导航。如果没有指定起点路由，则从根路由开始进行绝对导航。
   *
   * @param commands An array of URL fragments with which to construct the target URL.
   * If the path is static, can be the literal URL string. For a dynamic path, pass an array of path
   * segments, followed by the parameters for each segment.
   * The fragments are applied to the current URL or the one provided  in the `relativeTo` property
   * of the options object, if supplied.
   *
   * 一个 URL 段的数组，用于构造目标 URL 树。如果此路径是静态的，则可能是 URL 字符串字面量。对于动态路径，可以传入一个路径段的数组，后跟每个段的参数。这些段会应用到当前 URL，或者在选项对象中的 `relativeTo` 属性上（如果有）。
   * @param extras An options object that determines how the URL should be constructed or
   *     interpreted.
   *
   * 一个选项对象，用于确定应如何构造或解释 URL。
   * @returns
   *
   * A Promise that resolves to `true` when navigation succeeds, to `false` when navigation
   *     fails,
   * or is rejected on error.
   *
   * 一个 Promise，当导航成功时解析为 `true`，当导航失败时解析为 `false`，或因错误而被拒绝。
   *
   * @usageNotes
   *
   * The following calls request navigation to a dynamic route path relative to the current URL.
   *
   * 以下调用请求导航到相对于当前 URL 的动态路由路径。
   *
   * ```
   * router.navigate(['team', 33, 'user', 11], {relativeTo: route});
   *
   * // Navigate without updating the URL, overriding the default behavior
   * router.navigate(['team', 33, 'user', 11], {relativeTo: route, skipLocationChange: true});
   * ```
   * @see [Routing and Navigation guide](guide/router)
   *
   * [路由和导航指南](guide/router)
   */
  navigate(commands: any[], extras: NavigationExtras = {skipLocationChange: false}):
      Promise<boolean> {
    validateCommands(commands);
    return this.navigateByUrl(this.createUrlTree(commands, extras), extras);
  }

  /**
   * Serializes a `UrlTree` into a string
   *
   * 把 `UrlTree` 序列化为字符串
   *
   */
  serializeUrl(url: UrlTree): string {
    return this.urlSerializer.serialize(url);
  }

  /**
   * Parses a string into a `UrlTree`
   *
   * 把字符串解析为 `UrlTree`
   *
   */
  parseUrl(url: string): UrlTree {
    let urlTree: UrlTree;
    try {
      urlTree = this.urlSerializer.parse(url);
    } catch (e) {
      urlTree = this.malformedUriErrorHandler(e as URIError, this.urlSerializer, url);
    }
    return urlTree;
  }

  /**
   * Returns whether the url is activated.
   *
   * 返回 url 是否已激活。
   *
   * @deprecated
   *
   * Use `IsActiveMatchOptions` instead.
   *
   * 请改用 `IsActiveMatchOptions`。
   *
   * - The equivalent `IsActiveMatchOptions` for `true` is
   *   `{paths: 'exact', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored'}`.
   *
   *   `true` 的等效 `IsActiveMatchOptions` 是 `{paths: 'exact', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored'}`。
   *
   * - The equivalent for `false` is
   *   `{paths: 'subset', queryParams: 'subset', fragment: 'ignored', matrixParams: 'ignored'}`.
   *
   *   `false` 的等价物是 `{paths: 'subset', queryParams: 'subset', fragment: 'ignored', matrixParams: 'ignored'}`。
   *
   */
  isActive(url: string|UrlTree, exact: boolean): boolean;
  /**
   * Returns whether the url is activated.
   *
   * 返回 url 是否已激活。
   *
   */
  isActive(url: string|UrlTree, matchOptions: IsActiveMatchOptions): boolean;
  /** @internal */
  isActive(url: string|UrlTree, matchOptions: boolean|IsActiveMatchOptions): boolean;
  isActive(url: string|UrlTree, matchOptions: boolean|IsActiveMatchOptions): boolean {
    let options: IsActiveMatchOptions;
    if (matchOptions === true) {
      options = {...exactMatchOptions};
    } else if (matchOptions === false) {
      options = {...subsetMatchOptions};
    } else {
      options = matchOptions;
    }
    if (isUrlTree(url)) {
      return containsTree(this.currentUrlTree, url, options);
    }

    const urlTree = this.parseUrl(url);
    return containsTree(this.currentUrlTree, urlTree, options);
  }

  private removeEmptyProps(params: Params): Params {
    return Object.keys(params).reduce((result: Params, key: string) => {
      const value: any = params[key];
      if (value !== null && value !== undefined) {
        result[key] = value;
      }
      return result;
    }, {});
  }

  /** @internal */
  scheduleNavigation(
      rawUrl: UrlTree, source: NavigationTrigger, restoredState: RestoredState|null,
      extras: NavigationExtras,
      priorPromise?: {resolve: any, reject: any, promise: Promise<boolean>}): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }

    let resolve: any;
    let reject: any;
    let promise: Promise<boolean>;
    if (priorPromise) {
      resolve = priorPromise.resolve;
      reject = priorPromise.reject;
      promise = priorPromise.promise;
    } else {
      promise = new Promise<boolean>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    }

    // Indicate that the navigation is happening.
    const taskId = this.pendingTasks.add();
    afterNextNavigation(this, () => {
      // Remove pending task in a microtask to allow for cancelled
      // initial navigations and redirects within the same task.
      Promise.resolve().then(() => this.pendingTasks.remove(taskId));
    });

    this.navigationTransitions.handleNavigationRequest({
      source,
      restoredState,
      currentUrlTree: this.currentUrlTree,
      currentRawUrl: this.currentUrlTree,
      rawUrl,
      extras,
      resolve,
      reject,
      promise,
      currentSnapshot: this.routerState.snapshot,
      currentRouterState: this.routerState
    });

    // Make sure that the error is propagated even though `processNavigations` catch
    // handler does not rethrow
    return promise.catch((e: any) => {
      return Promise.reject(e);
    });
  }

  /** @internal */
  setBrowserUrl(url: UrlTree, transition: NavigationTransition) {
    const path = this.urlSerializer.serialize(url);
    if (this.location.isCurrentPathEqualTo(path) || !!transition.extras.replaceUrl) {
      // replacements do not update the target page
      const currentBrowserPageId = this.browserPageId;
      const state = {
        ...transition.extras.state,
        ...this.generateNgRouterState(transition.id, currentBrowserPageId)
      };
      this.location.replaceState(path, '', state);
    } else {
      const state = {
        ...transition.extras.state,
        ...this.generateNgRouterState(transition.id, (this.browserPageId ?? 0) + 1)
      };
      this.location.go(path, '', state);
    }
  }

  /**
   * Performs the necessary rollback action to restore the browser URL to the
   * state before the transition.
   *
   * 执行必要的回滚操作以将浏览器 URL 恢复到转换前的状态。
   *
   * @internal
   */
  restoreHistory(transition: NavigationTransition, restoringFromCaughtError = false) {
    if (this.canceledNavigationResolution === 'computed') {
      const currentBrowserPageId = this.browserPageId ?? this.currentPageId;
      const targetPagePosition = this.currentPageId - currentBrowserPageId;
      if (targetPagePosition !== 0) {
        this.location.historyGo(targetPagePosition);
      } else if (
          this.currentUrlTree === this.getCurrentNavigation()?.finalUrl &&
          targetPagePosition === 0) {
        // We got to the activation stage (where currentUrlTree is set to the navigation's
        // finalUrl), but we weren't moving anywhere in history (skipLocationChange or replaceUrl).
        // We still need to reset the router state back to what it was when the navigation started.
        this.resetState(transition);
        // TODO(atscott): resetting the `browserUrlTree` should really be done in `resetState`.
        // Investigate if this can be done by running TGP.
        this.browserUrlTree = transition.currentUrlTree;
        this.resetUrlToCurrentUrlTree();
      } else {
        // The browser URL and router state was not updated before the navigation cancelled so
        // there's no restoration needed.
      }
    } else if (this.canceledNavigationResolution === 'replace') {
      // TODO(atscott): It seems like we should _always_ reset the state here. It would be a no-op
      // for `deferred` navigations that haven't change the internal state yet because guards
      // reject. For 'eager' navigations, it seems like we also really should reset the state
      // because the navigation was cancelled. Investigate if this can be done by running TGP.
      if (restoringFromCaughtError) {
        this.resetState(transition);
      }
      this.resetUrlToCurrentUrlTree();
    }
  }

  private resetState(t: NavigationTransition): void {
    (this as {routerState: RouterState}).routerState = t.currentRouterState;
    this.currentUrlTree = t.currentUrlTree;
    // Note here that we use the urlHandlingStrategy to get the reset `rawUrlTree` because it may be
    // configured to handle only part of the navigation URL. This means we would only want to reset
    // the part of the navigation handled by the Angular router rather than the whole URL. In
    // addition, the URLHandlingStrategy may be configured to specifically preserve parts of the URL
    // when merging, such as the query params so they are not lost on a refresh.
    this.rawUrlTree = this.urlHandlingStrategy.merge(this.currentUrlTree, t.rawUrl);
  }

  private resetUrlToCurrentUrlTree(): void {
    this.location.replaceState(
        this.urlSerializer.serialize(this.rawUrlTree), '',
        this.generateNgRouterState(this.lastSuccessfulId, this.currentPageId));
  }

  private generateNgRouterState(navigationId: number, routerPageId?: number) {
    if (this.canceledNavigationResolution === 'computed') {
      return {navigationId, ɵrouterPageId: routerPageId};
    }
    return {navigationId};
  }
}

function validateCommands(commands: string[]): void {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd == null) {
      throw new RuntimeError(
          RuntimeErrorCode.NULLISH_COMMAND,
          (typeof ngDevMode === 'undefined' || ngDevMode) &&
              `The requested path contains ${cmd} segment at index ${i}`);
    }
  }
}
