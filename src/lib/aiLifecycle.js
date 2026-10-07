import { useEffect } from "react";
import { cancelAiTasks } from "./aiOperations.js";
export function useCancelAiOnLeave(labels, key = "") {
  const names = labels.join("|");
  useEffect(() => () => cancelAiTasks(names.split("|")), [names, key]);
}
