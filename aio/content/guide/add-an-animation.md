# Add an animation

# 添加动画

The main Angular modules for animations are `@angular/animations` and `@angular/platform-browser`.
When you create a new project using the Angular framework, these dependencies are automatically added to your project.

用于动画的主要 Angular 模块是 `@angular/animations` 和 `@angular/platform-browser`。当你使用 Angular 框架创建新项目时，这些依赖项会自动添加到你的项目中。

To get started with adding Angular animations to your project, import the animation-specific modules along with standard Angular capability.

要开始向你的项目添加 Angular 动画，请导入动画的专属模块以及标准的 Angular 功能。

## Step 1: Enabling the animations module

## 步骤一：启用动画模块

Import `BrowserAnimationsModule`, which introduces the animation capabilities into your Angular root application module.

导入 `BrowserAnimationsModule`，它能把动画能力引入 Angular 应用的根模块中。

<code-example header="src/app/app.module.ts" path="animations/src/app/app.module.1.ts"></code-example>

<div class="alert is-helpful">

**NOTE**: <br />
When you use the Angular framework to create your application, the root application module `app.module.ts` is placed in the `src/app` directory.  If you are using standalone components, look at main.ts or look at your root application component.

注意：<br />
当你使用 Angular 框架创建应用时，根应用模块 `app.module.ts` 位于 `src/app` 目录下。如果你正在使用独立的组件，请查看 `main.ts` 或应用的根组件。

</div>

## Step 2: Importing animation functions into component files

## 步骤二：把动画功能导入组件文件中

If you plan to use specific animation functions in component files, import those functions from `@angular/animations`.

如果你准备在组件文件中使用特定的动画函数，请从 `@angular/animations` 中导入这些函数。

<code-example header="src/app/app.component.ts" path="animations/src/app/app.component.ts" region="imports"></code-example>

## Step 3: Adding the animation metadata property

## 步骤三：添加动画的元数据属性

In the component file, add a metadata property called `animations:` within the `@Component()` decorator.
You put the trigger that defines an animation within the `animations` metadata property.

在组件的 `@Component()` 装饰器中，添加一个名叫 `animations:` 的元数据属性。你可以把用来定义动画的触发器放进 `animations` 元数据属性中。

<code-example header="src/app/app.component.ts" path="animations/src/app/app.component.ts" region="decorator"></code-example>

@reviewed 2022-12-19
