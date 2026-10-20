// The public surface of Home: the screen, the rules the shell uses to decide what Home shows, and the card and item
// summary the library's views reuse. Docs: docs/modules/practice/home.md.
export { default as HomeScreen } from "./HomeScreen";
export { default as StageCard } from "./StageCard";
export { describeItems, homeTabs, itemsScope, limitLessons, resolveHomeView } from "./homeState";
