"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Settings as SettingsIcon,
  Plus,
  Moon,
  Sun,
  Download,
  Upload,
  Calendar as CalendarIcon,
  CheckCircle,
  Clock,
  AlertTriangle,
  MoreHorizontal,
  X,
  Trash2,
  RefreshCcw,
  Check,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Activity,
  GitMerge,
  Repeat,
  Layers,
  ArrowRight,
  CalendarDays,
  CheckSquare,
  History,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  format,
  isToday,
  isTomorrow,
  parseISO,
  isAfter,
  isBefore,
  startOfDay,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  isSameDay,
  addDays,
  addWeeks,
  subWeeks,
  addYears,
  isWithinInterval,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ko } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import { fetchTasksFromServer, saveTasksToServer, isKVConfigured, checkServerKVStatus } from "../lib/kv";

const safeDate = (dateStr?: string | null): Date => {
  if (!dateStr) return new Date();
  try {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? new Date() : d;
  } catch {
    return new Date();
  }
};

const safeFormat = (dateInput: Date | string | null | undefined, formatStr: string, options?: any): string => {
  if (!dateInput) return "";
  try {
    const d = typeof dateInput === "string" ? safeDate(dateInput) : dateInput;
    if (isNaN(d.getTime())) return "";
    return format(d, formatStr, options);
  } catch {
    return "";
  }
};

type TaskType = "MEETING" | "BID" | "SUBMISSION" | "GENERAL" | "HOLIDAY" | "COMPANY_HOLIDAY" | "PERSONAL_LEAVE";
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type RecurrenceType = "NONE" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMI_ANNUALLY" | "ANNUALLY";

interface Task {
  id: string;
  title: string;
  type: TaskType;
  deadline: string; // ISO string
  status: TaskStatus;
  description?: string;
  color?: string;
  createdAt: string;
  completedAt?: string;
  // Recurrence
  recurrence?: RecurrenceType;
  parentId?: string;
  // Chain / Dependency
  nextTaskId?: string;
  prevTaskId?: string;
  // Span Date Support
  startDate?: string;
  endDate?: string;
  chainName?: string;
}

const STORAGE_KEY = "outsourcing_team_schedule_data";

const updateTaskDependencies = (
  taskList: Task[],
  targetId: string,
  newPrevId: string | undefined,
  newNextId: string | undefined
): Task[] => {
  return taskList.map(t => {
    let nextTaskId = t.nextTaskId;
    let prevTaskId = t.prevTaskId;

    // 1. If this is the edited task, set its new connections
    if (t.id === targetId) {
      nextTaskId = newNextId || undefined;
      prevTaskId = newPrevId || undefined;
    } else {
      // 2. If another task used to point to targetId as next, but targetId no longer has it as prev
      if (nextTaskId === targetId && newPrevId !== t.id) {
        nextTaskId = undefined;
      }
      // 3. If another task used to point to targetId as prev, but targetId no longer has it as next
      if (prevTaskId === targetId && newNextId !== t.id) {
        prevTaskId = undefined;
      }

      // 4. Set targetId as next for the new previous task
      if (newPrevId && t.id === newPrevId) {
        nextTaskId = targetId;
      }
      // 5. Set targetId as prev for the new next task
      if (newNextId && t.id === newNextId) {
        prevTaskId = targetId;
      }
    }

    return {
      ...t,
      nextTaskId,
      prevTaskId
    };
  });
};

const clearDeletedTaskDependencies = (taskList: Task[], deletedId: string): Task[] => {
  return taskList.map(t => {
    let nextTaskId = t.nextTaskId === deletedId ? undefined : t.nextTaskId;
    let prevTaskId = t.prevTaskId === deletedId ? undefined : t.prevTaskId;
    return { ...t, nextTaskId, prevTaskId };
  });
};

const isBusinessDay = (date: Date, tasks: Task[]): boolean => {
  const dayOfWeek = getDay(date); // 0 = Sunday, 6 = Saturday
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const targetDay = startOfDay(date);

  // Check if there is any holiday / leave task scheduled on this date
  const isHoliday = tasks.some(t => {
    if (t.type !== "HOLIDAY" && t.type !== "COMPANY_HOLIDAY" && t.type !== "PERSONAL_LEAVE") {
      return false;
    }
    const start = startOfDay(safeDate(t.startDate || t.deadline));
    const end = startOfDay(safeDate(t.endDate || t.deadline));
    return targetDay >= start && targetDay <= end;
  });

  return !isHoliday;
};

const countBusinessDaysBetween = (start: Date, end: Date, tasks: Task[]): number => {
  let startD = startOfDay(start);
  let endD = startOfDay(end);

  if (isSameDay(startD, endD)) return 0;

  let isNegative = false;
  if (isAfter(startD, endD)) {
    const temp = startD;
    startD = endD;
    endD = temp;
    isNegative = true;
  }

  let count = 0;
  let current = startD;
  while (!isSameDay(current, endD)) {
    current = addDays(current, 1);
    if (isBusinessDay(current, tasks)) {
      count++;
    }
  }

  return isNegative ? -count : count;
};

const getTaskTimePeriod = (task: Task): "BEFORE" | "DURING" | "AFTER" => {
  const today = startOfDay(new Date());
  const start = startOfDay(safeDate(task.startDate || task.deadline));
  const end = startOfDay(safeDate(task.endDate || task.deadline));
  if (today < start) return "BEFORE";
  if (today > end) return "AFTER";
  return "DURING";
};

const getTaskStatus = (task: Task): TaskStatus => {
  const period = getTaskTimePeriod(task);
  if (task.status === "DONE" || period === "AFTER") return "DONE";
  return period === "BEFORE" ? "TODO" : "IN_PROGRESS";
};

// Filter recurring tasks for the Work status board:
// Only show the single nearest active occurrence (IN_PROGRESS > earliest TODO).
// Exclude past occurrences if a future one is already scheduled.
const filterTasksForBoard = (taskList: Task[]): Task[] => {
  const recurringGroups: { [key: string]: Task[] } = {};
  const nonRecurringTasks: Task[] = [];

  taskList.forEach(t => {
    if (t.recurrence && t.recurrence !== "NONE") {
      // Group by parentId (or its own ID if it is the parent)
      const groupKey = t.parentId || t.id;
      if (!recurringGroups[groupKey]) {
        recurringGroups[groupKey] = [];
      }
      recurringGroups[groupKey].push(t);
    } else {
      nonRecurringTasks.push(t);
    }
  });

  const selectedRecurringTasks: Task[] = [];

  Object.values(recurringGroups).forEach(group => {
    // Sort tasks in chronological order
    const sorted = [...group].sort((a, b) => safeDate(a.deadline).getTime() - safeDate(b.deadline).getTime());
    
    // Find completed/past tasks within 2 business days and keep them
    const completedRetentionTasks = sorted.filter(t => {
      if (getTaskStatus(t) !== "DONE") return false;
      const refDate = safeDate(t.completedAt || t.endDate || t.deadline);
      return countBusinessDaysBetween(refDate, new Date(), taskList) <= 2;
    });
    
    completedRetentionTasks.forEach(t => {
      selectedRecurringTasks.push(t);
    });

    // Find the single active/upcoming task to show in TODO/IN_PROGRESS (or DONE if no upcoming)
    // Find if any is currently IN_PROGRESS
    const activeProgress = sorted.find(t => getTaskStatus(t) === "IN_PROGRESS");
    if (activeProgress) {
      if (!completedRetentionTasks.some(t => t.id === activeProgress.id)) {
        selectedRecurringTasks.push(activeProgress);
      }
      return;
    }

    // Find the nearest upcoming TODO task (today or future)
    const today = startOfDay(new Date());
    const upcomingTodo = sorted.find(t => {
      const status = getTaskStatus(t);
      const deadline = startOfDay(safeDate(t.deadline));
      return status === "TODO" && deadline >= today;
    });

    if (upcomingTodo) {
      if (!completedRetentionTasks.some(t => t.id === upcomingTodo.id)) {
        selectedRecurringTasks.push(upcomingTodo);
      }
      return;
    }

    // If all tasks are completed/past, show the latest completed/past task (if not already included)
    if (sorted.length > 0) {
      const latest = sorted[sorted.length - 1];
      if (!completedRetentionTasks.some(t => t.id === latest.id)) {
        selectedRecurringTasks.push(latest);
      }
    }
  });

  return [...nonRecurringTasks, ...selectedRecurringTasks];
};


export default function App() {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "tasks" | "calendar" | "workflows" | "periodic" | "settings"
  >("calendar");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<"LOCAL" | "GAS">("LOCAL");

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Deletion Modal States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<"ASK" | "PASSWORD">("ASK");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  // Chained Tasks Custom Setup Modal States
  const [isChainSetupModalOpen, setIsChainSetupModalOpen] = useState(false);
  const [selectedChainTasks, setSelectedChainTasks] = useState<string[]>([]);
  const [chainSortKey, setChainSortKey] = useState<"title" | "deadline">("deadline");

  // Renaming chain states
  const [renamingChainTaskId, setRenamingChainTaskId] = useState<string | null>(null);
  const [renamingChainName, setRenamingChainName] = useState<string>("");

  // Load Tasks
  useEffect(() => {
    const initialize = async () => {
      let loadedTasks: Task[] = [];
      let themeMode = "light";

      // Google Apps Script connection check (runs on deployment)
      if (typeof window !== "undefined") {
        try {
          const isConfigured = await checkServerKVStatus();
          if (isConfigured) {
            setDbStatus("GAS");
            const serverTasks = await fetchTasksFromServer();
            
            if (serverTasks && serverTasks.length > 0) {
              loadedTasks = serverTasks;
            } else {
              // If GAS is empty, check localStorage
              const saved = localStorage.getItem(STORAGE_KEY);
              if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.tasks && parsed.tasks.length > 0) {
                  loadedTasks = parsed.tasks;
                  await saveTasksToServer(loadedTasks);
                }
              }
            }
          } else {
            loadFromLocal();
          }
        } catch (e) {
          console.error("Vercel KV fetch error, falling back to local storage:", e);
          loadFromLocal();
        }
      } else {
        loadFromLocal();
      }

      function loadFromLocal() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.tasks) {
              loadedTasks = parsed.tasks;
            }
            if (parsed.theme === "dark") {
              themeMode = "dark";
            }
          } catch (e) {
            console.error("Failed to parse saved data");
          }
        }
        setDbStatus("LOCAL");
      }

      // Cleanup finished tasks older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const validTasks = loadedTasks.filter((t: Task) => {
        if (t.status === "DONE") {
          const compareDate = safeDate(t.completedAt || t.deadline);
          return isAfter(compareDate, thirtyDaysAgo);
        }
        return true;
      });

      setTasks(validTasks);
      if (themeMode === "dark") {
        setIsDarkMode(true);
        document.documentElement.classList.add("dark");
      }
      setLastSaved(new Date());
      setIsLoading(false);
    };

    initialize();
  }, []);

  // Save changes
  const saveTasksState = async (newTasks: Task[]) => {
    setTasks(newTasks);
    setLastSaved(new Date());

    // Sync to Google Spreadsheet if available
    try {
      await saveTasksToServer(newTasks);
      if (process.env.NODE_ENV === "production" || dbStatus === "GAS") {
        setDbStatus("GAS");
      }
    } catch (e) {
      console.error("Failed to sync with Google Spreadsheet:", e);
    }
    
    // Always keep localStorage updated as well
    const data = {
      tasks: newTasks,
      theme: isDarkMode ? "dark" : "light",
      lastSaved: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    if (newTheme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    
    const data = {
      tasks,
      theme: newTheme ? "dark" : "light",
      lastSaved: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const handleExportExcelCSV = () => {
    const headers = [
      "ID", "제목", "구분", "상태", "색상",
      "시작일(년/월/일)", "시작시간",
      "종료일(년/월/일)", "종료시간",
      "마감기한(년/월/일)", "마감시간",
      "상세설명", "반복주기", "연쇄업무명", "부모ID", "이전업무ID", "다음업무ID", "완료일시", "생성일시"
    ];
    
    const rows = tasks.map(t => {
      const start = t.startDate ? safeDate(t.startDate) : (t.deadline ? safeDate(t.deadline) : null);
      const end = t.endDate ? safeDate(t.endDate) : (t.deadline ? safeDate(t.deadline) : null);
      const dead = t.deadline ? safeDate(t.deadline) : null;
      
      const startDateStr = start ? safeFormat(start, "yyyy.MM.dd") : "";
      const startTimeStr = start ? (safeFormat(start, "HH:mm") === "00:00" ? "-" : safeFormat(start, "HH:mm")) : "-";
      const endDateStr = end ? safeFormat(end, "yyyy.MM.dd") : "";
      const endTimeStr = end ? (safeFormat(end, "HH:mm") === "00:00" ? "-" : safeFormat(end, "HH:mm")) : "-";
      const deadlineDateStr = dead ? safeFormat(dead, "yyyy.MM.dd") : "";
      const deadlineTimeStr = dead ? (safeFormat(dead, "HH:mm") === "00:00" ? "-" : safeFormat(dead, "HH:mm")) : "-";
      const completedAtStr = t.completedAt ? safeFormat(t.completedAt, "yyyy-MM-dd HH:mm:ss") : "";
      const createdAtStr = t.createdAt ? safeFormat(t.createdAt, "yyyy-MM-dd HH:mm:ss") : "";
      
      return [
        t.id || "",
        (t.title || "").replace(/"/g, '""'),
        t.type || "GENERAL",
        t.status || "TODO",
        t.color || "",
        startDateStr,
        startTimeStr,
        endDateStr,
        endTimeStr,
        deadlineDateStr,
        deadlineTimeStr,
        (t.description || "").replace(/"/g, '""'),
        t.recurrence || "NONE",
        t.chainName || "",
        t.parentId || "",
        t.prevTaskId || "",
        t.nextTaskId || "",
        completedAtStr,
        createdAtStr
      ];
    });

    const csvContent = "\uFEFF" + 
      [headers.join(","), ...rows.map(row => row.map(val => `"${val}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = format(new Date(), "yyyyMMdd_HHmmss");
    a.download = `외주구매팀_업무관리표_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearData = async () => {
    if (confirm("정말 구글 스프레드시트 및 로컬의 모든 일정을 초기화하시겠습니까? 삭제 후에는 복구할 수 없습니다.")) {
      await saveTasksState([]);
      alert("모든 일정 데이터가 초기화되었습니다.");
    }
  };

  const handleSaveTask = async (taskData: Omit<Task, "id" | "createdAt">) => {
    let updatedTasks = [...tasks];
    let targetId = "";

    if (editingTask && editingTask.id) {
      targetId = editingTask.id;
      // Modify existing
      const updatedTask = {
        ...editingTask,
        ...taskData,
        completedAt:
          taskData.status === "DONE" && editingTask.status !== "DONE"
            ? new Date().toISOString()
            : editingTask.completedAt,
      };

      // If task status changed to DONE, check if there's a dependent nextTaskId
      if (updatedTask.status === "DONE" && editingTask.status !== "DONE" && updatedTask.nextTaskId) {
        // Find next task and set it to TODO/IN_PROGRESS if it was waiting
        updatedTasks = updatedTasks.map(t => {
          if (t.id === updatedTask.nextTaskId) {
            return { ...t, status: "TODO" }; // Activate next task
          }
          return t;
        });
      }

      updatedTasks = updatedTasks.map((t) => (t.id === editingTask.id ? updatedTask : t));
    } else {
      // Create new
      const newId = crypto.randomUUID();
      targetId = newId;
      const newTask: Task = {
        ...taskData,
        id: newId,
        createdAt: new Date().toISOString(),
        completedAt:
          taskData.status === "DONE" ? new Date().toISOString() : undefined,
      };

      // Generate future recurrent tasks if recurrence is enabled
      const recurrentTasks: Task[] = [];
      if (newTask.recurrence && newTask.recurrence !== "NONE") {
        let recurrenceCount = 5; // Generate 5 iterations into the future
        let lastDate = parseISO(newTask.deadline);
        let originalStart = newTask.startDate ? parseISO(newTask.startDate) : null;
        let originalEnd = newTask.endDate ? parseISO(newTask.endDate) : null;

        for (let i = 1; i <= recurrenceCount; i++) {
          let nextDate: Date;
          let nextStart: Date | undefined;
          let nextEnd: Date | undefined;

          const getNextDate = (d: Date) => {
            if (newTask.recurrence === "WEEKLY") return addWeeks(d, i);
            if (newTask.recurrence === "MONTHLY") return addMonths(d, i);
            if (newTask.recurrence === "QUARTERLY") return addMonths(d, i * 3);
            if (newTask.recurrence === "SEMI_ANNUALLY") return addMonths(d, i * 6);
            return addYears(d, i); // ANNUALLY
          };

          nextDate = getNextDate(lastDate);
          if (originalStart) nextStart = getNextDate(originalStart);
          if (originalEnd) nextEnd = getNextDate(originalEnd);

          const recId = crypto.randomUUID();
          recurrentTasks.push({
            ...newTask,
            id: recId,
            parentId: newTask.id,
            deadline: nextDate.toISOString(),
            startDate: nextStart ? nextStart.toISOString() : undefined,
            endDate: nextEnd ? nextEnd.toISOString() : undefined,
            status: "TODO",
            createdAt: new Date().toISOString(),
            completedAt: undefined,
          });
        }
      }

      updatedTasks = [...updatedTasks, newTask, ...recurrentTasks];
    }

    // Sync dependencies bidirectionally
    updatedTasks = updateTaskDependencies(updatedTasks, targetId, taskData.prevTaskId, taskData.nextTaskId);

    await saveTasksState(updatedTasks);
    setIsTaskModalOpen(false);
    setEditingTask(null);
  };

  const openNewTaskModal = (defaultDate?: Date) => {
    if (defaultDate) {
      setEditingTask({
        id: "",
        title: "",
        type: "GENERAL",
        deadline: defaultDate.toISOString(),
        status: "TODO",
        startDate: defaultDate.toISOString(),
        endDate: defaultDate.toISOString(),
        createdAt: "",
      });
    } else {
      setEditingTask(null);
    }
    setIsTaskModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const openRescheduleTaskModal = (task: Task) => {
    setRescheduleTask(task);
    setIsRescheduleModalOpen(true);
  };

  const handleSaveRescheduledTask = async (
    taskId: string,
    dates: { deadline: string; startDate: string; endDate: string }
  ) => {
    let updatedTasks = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          status: "IN_PROGRESS" as TaskStatus,
          completedAt: undefined,
          deadline: dates.deadline,
          startDate: dates.startDate,
          endDate: dates.endDate,
        };
      }
      return t;
    });

    await saveTasksState(updatedTasks);
    setIsRescheduleModalOpen(false);
    setRescheduleTask(null);
  };

  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    let updatedTasks = tasks.map((t) => {
      if (t.id === id) {
        const completedAt = status === "DONE" && t.status !== "DONE"
          ? new Date().toISOString()
          : t.completedAt;
        return { ...t, status, completedAt };
      }
      return t;
    });

    // Check dependency cascade
    const updatedTask = updatedTasks.find(t => t.id === id);
    if (updatedTask && updatedTask.status === "DONE" && updatedTask.nextTaskId) {
      updatedTasks = updatedTasks.map(t => {
        if (t.id === updatedTask.nextTaskId && t.status !== "DONE") {
          return { ...t, status: "TODO" }; // Trigger next
        }
        return t;
      });
    }

    await saveTasksState(updatedTasks);
  };

  const handleDeleteTask = async (id: string) => {
    let updatedTasks = clearDeletedTaskDependencies(tasks, id);
    updatedTasks = updatedTasks.filter((t) => t.id !== id);
    await saveTasksState(updatedTasks);
    setIsTaskModalOpen(false);
  };

  const handleSaveChain = async () => {
    if (selectedChainTasks.length < 2) {
      alert("연쇄 업무를 설정하려면 최소 2개 이상의 일정을 선택해야 합니다.");
      return;
    }

    let updatedTasks = [...tasks];

    // Clear existing connections for all selected tasks first to avoid dangling cross-links
    updatedTasks = updatedTasks.map(t => {
      if (selectedChainTasks.includes(t.id)) {
        return { ...t, prevTaskId: undefined, nextTaskId: undefined };
      }
      return t;
    });

    // Sequentially set the new chain links using our bidirectional update helper
    for (let i = 0; i < selectedChainTasks.length; i++) {
      const currentId = selectedChainTasks[i];
      const prevId = i > 0 ? selectedChainTasks[i - 1] : undefined;
      const nextId = i < selectedChainTasks.length - 1 ? selectedChainTasks[i + 1] : undefined;

      updatedTasks = updateTaskDependencies(updatedTasks, currentId, prevId, nextId);
    }

    await saveTasksState(updatedTasks);
    setIsChainSetupModalOpen(false);
    setSelectedChainTasks([]);
  };

  const handleSaveChainName = async (startTaskId: string, newName: string) => {
    if (!newName.trim()) return;
    const updatedTasks = tasks.map(t => {
      if (t.id === startTaskId) {
        return { ...t, chainName: newName.trim() };
      }
      return t;
    });
    await saveTasksState(updatedTasks);
    setRenamingChainTaskId(null);
  };

  // Safe purge Vercel KV with password protection
  const handlePurgeAllData = async () => {
    if (deletePassword === "123") {
      await saveTasksState([]);
      setIsDeleteModalOpen(false);
      setDeletePassword("");
      setDeleteError("");
      alert("모든 데이터가 성공적으로 초기화되었습니다.");
    } else {
      setDeleteError("비밀번호가 올바르지 않습니다. 다시 입력해 주세요.");
    }
  };

  // Derived states
  const todayTasks = tasks.filter(
    (t) => t.status !== "DONE" && isToday(safeDate(t.deadline)),
  );
  const upcomingDeadlines = tasks
    .filter(
      (t) =>
        t.status !== "DONE" &&
        isAfter(safeDate(t.deadline), startOfDay(new Date())),
    )
    .sort(
      (a, b) => safeDate(a.deadline).getTime() - safeDate(b.deadline).getTime(),
    )
    .slice(0, 5);

  const inProgressMultiDayTasks = tasks.filter((t) => {
    if (t.status !== "IN_PROGRESS") return false;
    if (!t.startDate || !t.endDate) return false;
    const start = startOfDay(safeDate(t.startDate));
    const end = startOfDay(safeDate(t.endDate));
    if (isSameDay(start, end)) return false;
    const today = startOfDay(new Date());
    return isWithinInterval(today, { start, end });
  });

  if (isLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center text-primary font-bold">
        로딩 중... ({dbStatus === "GAS" ? "구글 스프레드시트 동기화" : "로컬 모드"})
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-background text-on-background overflow-hidden font-body selection:bg-primary-container selection:text-on-primary-container">
      {/* Left Navigation */}
      <nav className={`relative flex-shrink-0 bg-surface border-r border-border flex flex-col hidden md:flex transition-all duration-300 ${isSidebarOpen ? "w-64" : "w-16"}`}>
        {/* Toggle Button in middle-right edge of sidebar */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-3.5 top-1/2 -translate-y-1/2 z-30 w-7 h-7 rounded-full bg-surface border border-border text-on-surface-variant hover:text-primary hover:bg-surface-variant flex items-center justify-center shadow-md transition-transform hover:scale-110"
          title={isSidebarOpen ? "메뉴바 접기" : "메뉴바 펼치기"}
        >
          {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className={`p-4 border-b border-border/50 ${isSidebarOpen ? "p-6 pb-8" : "flex justify-center"}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm flex-shrink-0">
              <ClipboardList className="w-6 h-6" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <h1 className="font-headline text-xl font-bold text-primary leading-tight truncate">
                  업무관리표
                </h1>
                <p className="text-xs text-on-surface-variant font-medium truncate">
                  외주구매팀
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          <NavItem
            icon={<CalendarIcon className="w-5 h-5 flex-shrink-0" />}
            label="캘린더"
            isActive={activeTab === "calendar"}
            onClick={() => setActiveTab("calendar")}
            isCollapsed={!isSidebarOpen}
          />
          <NavItem
            icon={<LayoutDashboard className="w-5 h-5 flex-shrink-0" />}
            label="대시보드"
            isActive={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
            isCollapsed={!isSidebarOpen}
          />
          <NavItem
            icon={<ClipboardList className="w-5 h-5 flex-shrink-0" />}
            label="작업현황"
            isActive={activeTab === "tasks"}
            onClick={() => setActiveTab("tasks")}
            isCollapsed={!isSidebarOpen}
          />
          <NavItem
            icon={<GitMerge className="w-5 h-5 text-tertiary flex-shrink-0" />}
            label="연쇄 업무 설정"
            isActive={activeTab === "workflows"}
            onClick={() => setActiveTab("workflows")}
            isCollapsed={!isSidebarOpen}
          />
          <NavItem
            icon={<History className="w-5 h-5 text-primary flex-shrink-0" />}
            label="주기별 업무 관리"
            isActive={activeTab === "periodic"}
            onClick={() => setActiveTab("periodic")}
            isCollapsed={!isSidebarOpen}
          />
          <NavItem
            icon={<SettingsIcon className="w-5 h-5 flex-shrink-0" />}
            label="설정 및 백업"
            isActive={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
            isCollapsed={!isSidebarOpen}
          />
        </div>

        <div className="p-3 border-t border-border/50 flex flex-col gap-3">
          <div className={`flex items-center ${isSidebarOpen ? "justify-between px-1" : "justify-center"}`}>
            {isSidebarOpen && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant truncate">
                <CheckCircle className={`w-3.5 h-3.5 flex-shrink-0 ${dbStatus === "GAS" ? "text-primary" : "text-amber-500"}`} />
                <span className="truncate">{dbStatus === "GAS" ? "구글 스프레드시트 동기화됨" : "로컬 브라우저 저장"}</span>
              </div>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-surface-variant text-on-surface-variant transition-colors flex-shrink-0"
              title={isDarkMode ? "라이트 모드로 변경" : "다크 모드로 변경"}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={() => openNewTaskModal()}
            title={!isSidebarOpen ? "일정 추가" : undefined}
            className={`relative w-full py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm ${
              isSidebarOpen ? "px-4" : "px-0"
            }`}
          >
            <Plus className={`${isSidebarOpen ? "absolute left-5" : ""} w-5 h-5`} />
            {isSidebarOpen && <span>일정 추가</span>}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full lg:h-[100dvh] overflow-hidden">
        {/* Mobile Header */}
        <header className="h-16 px-6 border-b border-border bg-surface flex items-center justify-between flex-shrink-0 z-10 md:hidden">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            <span className="font-headline font-bold">외주구매팀</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-surface-variant text-on-surface-variant transition-colors"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-2 sm:p-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-6 cell-scroll">
          <div className="max-w-7xl mx-auto h-full lg:h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === "dashboard" && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex-1 flex flex-col gap-4 sm:gap-6 h-auto lg:h-full pb-24 sm:pb-8 pt-2"
                >
                  {/* Stats Row */}
                  <div className="grid grid-cols-3 gap-2.5 sm:gap-6 shrink-0">
                    <div className="bg-surface rounded-xl sm:rounded-2xl p-3.5 sm:p-5 border border-border shadow-sm flex items-center justify-between hover:border-primary/50 transition-colors min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] sm:text-sm font-bold text-on-surface-variant mb-1 sm:mb-1 truncate">오늘의 일정</p>
                        <h3 className="text-xl sm:text-3xl font-headline font-bold text-primary truncate">{todayTasks.length}</h3>
                      </div>
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-primary-container text-primary flex items-center justify-center flex-shrink-0 ml-1">
                        <CheckCircle className="w-4 h-4 sm:w-6 h-6" />
                      </div>
                    </div>
                    <div className="bg-surface rounded-xl sm:rounded-2xl p-3.5 sm:p-5 border border-border shadow-sm flex items-center justify-between hover:border-tertiary/50 transition-colors min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] sm:text-sm font-bold text-on-surface-variant mb-1 sm:mb-1 truncate">진행중 일정</p>
                        <h3 className="text-xl sm:text-3xl font-headline font-bold text-tertiary truncate">
                          {inProgressMultiDayTasks.length}
                        </h3>
                      </div>
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-tertiary-container text-tertiary flex items-center justify-center flex-shrink-0 ml-1">
                        <Activity className="w-4 h-4 sm:w-6 h-6" />
                      </div>
                    </div>
                    <div className="bg-surface rounded-xl sm:rounded-2xl p-3.5 sm:p-5 border border-border shadow-sm flex items-center justify-between hover:border-error/50 transition-colors min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] sm:text-sm font-bold text-on-surface-variant mb-1 sm:mb-1 truncate">마감 예정</p>
                        <h3 className="text-xl sm:text-3xl font-headline font-bold text-error truncate">{upcomingDeadlines.length}</h3>
                      </div>
                      <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-error-container text-error flex items-center justify-center flex-shrink-0 ml-1">
                        <AlertTriangle className="w-4 h-4 sm:w-6 h-6" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 lg:min-h-0">
                    {/* Main Schedule List */}
                    <div className="lg:col-span-2 bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-sm flex flex-col min-h-[350px] lg:min-h-0 lg:overflow-hidden">
                      <h3 className="font-headline text-lg sm:text-xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-on-surface">
                        <CalendarIcon className="w-5 h-5 sm:w-6 h-6 text-primary" />
                        전체 일정 타임라인
                      </h3>

                      {tasks.length === 0 ? (
                        <div className="h-48 sm:h-full flex flex-col items-center justify-center text-on-surface-variant opacity-60">
                          <ClipboardList className="w-12 h-12 mb-4 opacity-50" />
                          <p>등록된 일정이 없습니다.</p>
                          <button onClick={() => openNewTaskModal()} className="mt-4 text-primary font-bold hover:underline">
                            첫 번째 일정 추가하기
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3 overflow-y-auto pr-2 flex-1 cell-scroll">
                          {tasks
                            .slice()
                            .sort((a, b) => safeDate(a.deadline).getTime() - safeDate(b.deadline).getTime())
                            .map((task) => (
                              <div
                                key={task.id}
                                onClick={() => openEditTaskModal(task)}
                                className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border hover:bg-surface-variant transition-colors cursor-pointer group"
                              >
                                <div className="mt-1">
                                  {task.status === "DONE" ? (
                                    <CheckCircle className="w-5 h-5 text-primary opacity-60" />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full border-2 border-border group-hover:border-primary transition-colors" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                                    <TaskBadge type={task.type} />
                                    <h4 className={`font-bold text-xs sm:text-sm truncate max-w-full ${task.status === "DONE" ? "line-through text-on-surface-variant opacity-60" : ""}`}>
                                      {task.title}
                                    </h4>
                                    {task.recurrence && task.recurrence !== "NONE" && (
                                      <Repeat className="w-3.5 h-3.5 text-tertiary" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4 text-[11px] sm:text-sm text-on-surface-variant mt-2">
                                    <span className="flex items-center gap-1 font-medium bg-background px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md border border-border">
                                      <Clock className="w-3.5 h-3.5" />
                                      {safeFormat(task.deadline, "yyyy년 MM월 dd일 HH:mm", { locale: ko })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Today & Upcoming */}
                    <div className="flex flex-col gap-6 lg:overflow-hidden lg:min-h-0">
                      {/* Today's Tasks */}
                      <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-sm flex-1 flex flex-col min-h-[220px] lg:min-h-0 lg:overflow-hidden">
                        <h3 className="font-headline text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center gap-2 text-primary">
                          <CheckCircle className="w-5 h-5" />
                          오늘의 할 일
                        </h3>
                        {todayTasks.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-xs sm:text-sm text-on-surface-variant font-medium border-2 border-dashed border-border rounded-xl min-h-[120px]">
                            오늘 예정된 일정이 없습니다.
                          </div>
                        ) : (
                          <div className="space-y-3 overflow-y-auto pr-1 cell-scroll max-h-[300px] lg:max-h-none flex-1">
                            {todayTasks.map((task) => (
                              <div
                                key={task.id}
                                onClick={() => openEditTaskModal(task)}
                                className="p-3 bg-surface-variant hover:bg-border cursor-pointer transition-colors rounded-xl text-xs sm:text-sm border border-border/50"
                              >
                                <div className="font-bold mb-1 truncate">{task.title}</div>
                                <div className="text-on-surface-variant flex items-center gap-1 font-medium text-[10px] sm:text-xs">
                                  <Clock className="w-3.5 h-3.5" />
                                  {safeFormat(task.deadline, "a h:mm", { locale: ko })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Upcoming Deadlines */}
                      <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-sm flex-1 flex flex-col min-h-[220px] lg:min-h-0 lg:overflow-hidden">
                        <h3 className="font-headline text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center gap-2 text-tertiary">
                          <AlertTriangle className="w-5 h-5" />
                          다가오는 마감일
                        </h3>
                        {upcomingDeadlines.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-xs sm:text-sm text-on-surface-variant font-medium border-2 border-dashed border-border rounded-xl min-h-[120px]">
                            다가오는 마감이 없습니다.
                          </div>
                        ) : (
                          <div className="space-y-3 overflow-y-auto pr-1 cell-scroll max-h-[300px] lg:max-h-none flex-1">
                            {upcomingDeadlines.map((task) => {
                              const date = safeDate(task.deadline);
                              const isTom = isTomorrow(date);
                              return (
                                <div
                                  key={task.id}
                                  onClick={() => openEditTaskModal(task)}
                                  className="p-3 border-l-4 border-tertiary bg-tertiary-container/10 hover:bg-tertiary-container/20 cursor-pointer transition-colors rounded-r-xl rounded-l-sm border-y border-r border-border/50"
                                >
                                  <div className="font-bold text-xs sm:text-sm mb-1 truncate">{task.title}</div>
                                  <div className="text-[10px] sm:text-xs text-on-surface-variant flex items-center justify-between font-medium mt-1">
                                    <span>{safeFormat(date, "MMM do (E)", { locale: ko })}</span>
                                    <span className="font-bold text-tertiary px-1.5 py-0.2 bg-tertiary-container/30 rounded-full text-[9px] sm:text-[11px]">
                                      {isTom ? "내일" : safeFormat(date, "MM/dd")}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "tasks" && (
                <motion.div
                  key="tasks"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-full flex flex-col pt-2"
                >

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 sm:overflow-hidden pb-16 sm:pb-0">
                    <TaskColumn
                      title="해야 할 일"
                      tasks={filterTasksForBoard(tasks).filter((t) => getTaskStatus(t) === "TODO")}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
                      onRescheduleTask={openRescheduleTaskModal}
                      status="TODO"
                      accent="bg-border"
                    />
                    <TaskColumn
                      title="진행 중"
                      tasks={filterTasksForBoard(tasks).filter((t) => getTaskStatus(t) === "IN_PROGRESS")}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
                      onRescheduleTask={openRescheduleTaskModal}
                      status="IN_PROGRESS"
                      accent="bg-tertiary"
                    />
                    <TaskColumn
                      title="완료"
                      tasks={filterTasksForBoard(tasks).filter((t) => {
                        if (getTaskStatus(t) !== "DONE") return false;
                        const refDate = safeDate(t.completedAt || t.endDate || t.deadline);
                        return countBusinessDaysBetween(refDate, new Date(), tasks) <= 2;
                      })}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
                      onRescheduleTask={openRescheduleTaskModal}
                      status="DONE"
                      accent="bg-primary"
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === "calendar" && (
                <motion.div
                  key="calendar"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-full flex flex-col pb-6 w-full"
                >
                  <div className="mb-6 flex-shrink-0">
                    <h2 className="font-headline text-3xl font-bold mb-1">캘린더</h2>
                    <p className="text-on-surface-variant">월별 전체 일정을 확인하세요.</p>
                  </div>
                  <div className="flex-1 overflow-hidden bg-surface rounded-2xl border border-border shadow-sm flex flex-col p-4 md:p-6">
                    <FullCalendar
                      tasks={tasks}
                      onEditTask={openEditTaskModal}
                      onAddTask={(date) => {
                        setEditingTask({
                          id: "",
                          title: "",
                          type: "GENERAL",
                          deadline: date.toISOString(),
                          status: "TODO",
                          startDate: date.toISOString(),
                          endDate: date.toISOString(),
                          createdAt: "",
                        });
                        setIsTaskModalOpen(true);
                      }}
                      selectedDate={selectedCalendarDate}
                      onSelectDate={setSelectedCalendarDate}
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === "workflows" && (
                <motion.div
                  key="workflows"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-full flex flex-col pb-6"
                >
                  <div className="mb-6 flex-shrink-0">
                    <h2 className="font-headline text-3xl font-bold mb-1">연쇄 업무 설정</h2>
                    <p className="text-on-surface-variant">
                      선후 관계가 연결되어 순서대로 처리해야 하는 주요 업무 프로세스를 관리합니다.
                    </p>
                  </div>

                  <div className="flex-1 bg-surface rounded-2xl border border-border p-6 shadow-sm overflow-y-auto">
                    <div className="space-y-6">
                      <div className="flex justify-between items-center pb-4 border-b border-border">
                        <span className="text-sm font-bold text-on-surface-variant">
                          순차 실행 프로세스 구조 (업무를 누르면 수정하거나 새 후속 업무를 생성할 수 있습니다)
                        </span>
                        <button
                          onClick={() => {
                            setSelectedChainTasks([]);
                            setIsChainSetupModalOpen(true);
                          }}
                          className="px-4 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-1 hover:opacity-90 transition-opacity"
                        >
                          <GitMerge className="w-4 h-4" /> 기존 업무 연쇄 업무로 설정하기
                        </button>
                      </div>

                      {tasks.filter(t => !t.prevTaskId && t.nextTaskId).length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-on-surface-variant opacity-60 border-2 border-dashed border-border rounded-xl">
                          <GitMerge className="w-12 h-12 mb-4 text-tertiary" />
                          <p>설정된 연쇄 업무가 없습니다.</p>
                          <p className="text-xs mt-1">일정을 등록할 때 '후속 업무 연동'을 설정하여 시작해 보세요.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {tasks.filter(t => !t.prevTaskId && t.nextTaskId).map(startTask => {
                            // Traverse the chain
                            const chain: Task[] = [startTask];
                            let current = startTask;
                            while (current.nextTaskId) {
                              const next = tasks.find(t => t.id === current.nextTaskId);
                              if (next) {
                                chain.push(next);
                                current = next;
                              } else {
                                break;
                              }
                            }

                            return (
                              <div key={startTask.id} className="p-5 rounded-2xl bg-surface-variant/30 border border-border flex flex-col gap-4">
                                {renamingChainTaskId === startTask.id ? (
                                  <div className="flex items-center gap-2 flex-1">
                                    <input
                                      type="text"
                                      value={renamingChainName}
                                      onChange={(e) => setRenamingChainName(e.target.value)}
                                      className="flex-1 px-2.5 py-1 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-1 focus:ring-primary font-bold text-on-surface"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleSaveChainName(startTask.id, renamingChainName);
                                        } else if (e.key === "Escape") {
                                          setRenamingChainTaskId(null);
                                        }
                                      }}
                                    />
                                    <button
                                      onClick={() => handleSaveChainName(startTask.id, renamingChainName)}
                                      className="p-1 text-primary hover:bg-surface-variant rounded-md"
                                      title="저장"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => setRenamingChainTaskId(null)}
                                      className="p-1 text-on-surface-variant hover:bg-surface-variant rounded-md"
                                      title="취소"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <h3 className="font-bold text-md text-primary flex items-center justify-between group flex-1">
                                    <span className="flex items-center gap-2">
                                      <Layers className="w-4 h-4" />
                                      {startTask.chainName || `${startTask.title.split(" ")[0] || "업무"} 연쇄 프로세스`}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setRenamingChainTaskId(startTask.id);
                                        setRenamingChainName(startTask.chainName || `${startTask.title.split(" ")[0] || "업무"} 연쇄 프로세스`);
                                      }}
                                      className="p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-variant rounded-md text-on-surface-variant transition-opacity ml-2"
                                      title="이름 수정"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </h3>
                                )}
                                
                                <div className="flex flex-col gap-3">
                                  {chain.map((task, idx) => (
                                    <React.Fragment key={task.id}>
                                      <div
                                        onClick={() => openEditTaskModal(task)}
                                        className={`p-3 rounded-xl border cursor-pointer hover:border-primary transition-all flex items-center justify-between ${
                                          task.status === "DONE"
                                            ? "bg-primary-container/20 border-primary/30 text-on-surface-variant"
                                            : task.status === "IN_PROGRESS"
                                            ? "bg-tertiary-container/20 border-tertiary/40"
                                            : "bg-surface border-border"
                                        }`}
                                      >
                                        <div className="flex items-center gap-2.5">
                                          <span className="w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-xs font-bold">
                                            {idx + 1}
                                          </span>
                                          <div>
                                            <p className={`font-bold text-sm ${task.status === "DONE" ? "line-through opacity-70" : ""}`}>
                                              {task.title}
                                            </p>
                                            <p className="text-[10px] text-on-surface-variant">
                                              마감: {format(parseISO(task.deadline), "MM/dd HH:mm")}
                                            </p>
                                          </div>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                          task.status === "DONE" ? "bg-primary text-on-primary" : "bg-surface-variant text-on-surface-variant"
                                        }`}>
                                          {task.status === "DONE" ? "완료" : task.status === "IN_PROGRESS" ? "진행중" : "대기중"}
                                        </span>
                                      </div>
                                      {idx < chain.length - 1 && (
                                        <div className="flex justify-center my-0.5">
                                          <ChevronDown className="w-5 h-5 text-on-surface-variant/40 animate-pulse" />
                                        </div>
                                      )}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "periodic" && (
                <motion.div
                  key="periodic"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-full flex flex-col pb-6"
                >
                  <div className="mb-6 flex-shrink-0">
                    <h2 className="font-headline text-3xl font-bold mb-1">주기별 업무 관리</h2>
                    <p className="text-on-surface-variant">연간, 반기, 분기 단위로 반복해서 챙겨야 하는 정기 점검 및 구매업무 관리판입니다.</p>
                  </div>

                  <div className="flex-1 bg-surface rounded-2xl border border-border p-6 shadow-sm overflow-hidden flex flex-col">
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="p-4 rounded-xl border border-border bg-surface-variant/20">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">연간 업무 수</h4>
                        <p className="text-2xl font-bold text-primary">{tasks.filter(t => t.recurrence === "ANNUALLY").length}개</p>
                      </div>
                      <div className="p-4 rounded-xl border border-border bg-surface-variant/20">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">반기 업무 수</h4>
                        <p className="text-2xl font-bold text-tertiary">{tasks.filter(t => t.recurrence === "SEMI_ANNUALLY").length}개</p>
                      </div>
                      <div className="p-4 rounded-xl border border-border bg-surface-variant/20">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">분기 업무 수</h4>
                        <p className="text-2xl font-bold text-error">{tasks.filter(t => t.recurrence === "QUARTERLY").length}개</p>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-6">
                      {/* Annually Section */}
                      <div>
                        <h3 className="text-base font-bold mb-3 flex items-center gap-2 border-b border-border pb-2 text-primary">
                          <History className="w-5 h-5" /> 연간 정기 업무
                        </h3>
                        <PeriodicTable tasks={tasks.filter(t => t.recurrence === "ANNUALLY")} onEdit={openEditTaskModal} onStatusUpdate={updateTaskStatus} />
                      </div>

                      {/* Semi-Annually Section */}
                      <div className="pt-4">
                        <h3 className="text-base font-bold mb-3 flex items-center gap-2 border-b border-border pb-2 text-tertiary">
                          <History className="w-5 h-5" /> 반기 정기 업무
                        </h3>
                        <PeriodicTable tasks={tasks.filter(t => t.recurrence === "SEMI_ANNUALLY")} onEdit={openEditTaskModal} onStatusUpdate={updateTaskStatus} />
                      </div>

                      {/* Quarterly Section */}
                      <div className="pt-4">
                        <h3 className="text-base font-bold mb-3 flex items-center gap-2 border-b border-border pb-2 text-error">
                          <History className="w-5 h-5" /> 분기 정기 업무
                        </h3>
                        <PeriodicTable tasks={tasks.filter(t => t.recurrence === "QUARTERLY")} onEdit={openEditTaskModal} onStatusUpdate={updateTaskStatus} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "settings" && (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-3xl pb-20"
                >
                  <h2 className="font-headline text-3xl font-bold mb-2">설정 및 백업</h2>
                  <p className="text-on-surface-variant mb-8">앱 환경 설정과 데이터를 관리하세요.</p>

                  <div className="space-y-6">
                    {/* Database status */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-border shadow-sm">
                      <h3 className="font-headline text-xl font-bold mb-2">서버 연결 상태</h3>
                      <p className="text-sm text-on-surface-variant mb-4">
                        {dbStatus === "GAS"
                          ? "구글 스프레드시트 데이터베이스에 정상 연동되었습니다. 스프레드시트의 행과 실시간 동기화되어 언제든 데이터를 시각적으로 확인하고 직접 편집할 수 있습니다."
                          : "로컬 오프라인 모드입니다. 구글 스프레드시트의 웹 앱 URL을 환경 변수 GAS_WEBHOOK_URL로 등록하시면 클라우드 연동 모드로 전환됩니다."}
                      </p>
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-variant text-sm font-bold border border-border">
                        <div className={`w-2.5 h-2.5 rounded-full ${dbStatus === "GAS" ? "bg-primary animate-pulse" : "bg-amber-500"}`} />
                        <span>{dbStatus === "GAS" ? "구글 스프레드시트 연동 완료" : "로컬 브라우저 저장 모드"}</span>
                      </div>
                    </div>

                    {/* Backup Section */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-border shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-primary-container text-primary rounded-xl flex items-center justify-center">
                          <Download className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-headline text-xl font-bold">오프라인 데이터 내보내기</h3>
                          <p className="text-sm text-on-surface-variant">구글 스프레드시트 양식과 동일한 형태로 전체 일정을 엑셀(CSV) 파일로 저장합니다.</p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 mt-4">
                        <button
                          onClick={handleExportExcelCSV}
                          className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
                        >
                          <Download className="w-5 h-5" />
                          엑셀(CSV) 파일 다운로드
                        </button>
                      </div>
                    </div>

                    {/* Purge / Clear Database section */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-error/30 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-error-container text-error rounded-xl flex items-center justify-center">
                          <Trash2 className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-headline text-xl font-bold text-error">전체 데이터 초기화</h3>
                          <p className="text-sm text-on-surface-variant">구글 스프레드시트 및 로컬 브라우저의 모든 일정 데이터를 영구적으로 비웁니다.</p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setDeleteConfirmStep("ASK");
                          setDeletePassword("");
                          setDeleteError("");
                          setIsDeleteModalOpen(true);
                        }}
                        className="mt-4 px-6 py-3 bg-error text-on-error font-bold rounded-xl hover:opacity-90 transition-opacity w-full md:w-auto"
                      >
                        데이터베이스 완전 초기화
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-between px-6 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] z-50">
        <MobileNavItem icon={<CalendarIcon />} isActive={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
        <MobileNavItem icon={<LayoutDashboard />} isActive={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")} />
        <button
          onClick={() => openNewTaskModal(selectedCalendarDate || new Date())}
          className="w-12 h-12 flex-shrink-0 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg transform -translate-y-4"
        >
          <Plus className="w-6 h-6" />
        </button>
        <MobileNavItem icon={<ClipboardList />} isActive={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
        <MobileNavItem icon={<SettingsIcon />} isActive={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
      </nav>

      {/* Task Modal */}
      <AnimatePresence>
        {isTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setIsTaskModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-surface w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden h-[92vh] sm:h-[815px] flex flex-col border border-border"
            >
              <div className="flex justify-between items-center p-6 border-b border-border flex-shrink-0">
                <h2 className="font-headline text-xl font-bold">
                  {editingTask && editingTask.id ? "일정 수정" : "새 일정 등록"}
                </h2>
                <button
                  onClick={() => setIsTaskModalOpen(false)}
                  className="p-2 hover:bg-surface-variant rounded-full text-on-surface-variant flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <TaskForm
                initialData={editingTask}
                tasks={tasks}
                onSubmit={handleSaveTask}
                onCancel={() => setIsTaskModalOpen(false)}
                onDelete={editingTask && editingTask.id ? () => handleDeleteTask(editingTask.id) : undefined}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reschedule Modal */}
      <AnimatePresence>
        {isRescheduleModalOpen && rescheduleTask && (
          <RescheduleModal
            task={rescheduleTask}
            tasks={tasks}
            onSave={handleSaveRescheduledTask}
            onCancel={() => {
              setIsRescheduleModalOpen(false);
              setRescheduleTask(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Purge Confirm Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setIsDeleteModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-surface w-full max-w-md rounded-2xl shadow-2xl p-6 border border-border"
            >
              <div className="flex items-center gap-3 text-error mb-4">
                <AlertTriangle className="w-8 h-8" />
                <h3 className="text-xl font-headline font-bold">데이터베이스 전체 삭제 경고</h3>
              </div>

              {deleteConfirmStep === "ASK" ? (
                <div>
                  <p className="text-sm text-on-surface mb-6 leading-relaxed">
                    정말로 모든 일정 데이터를 삭제하시겠습니까?<br />
                    이 작업은 되돌릴 수 없으며, Vercel KV 및 로컬 스토리지에 있는 모든 기록이 완전 소멸됩니다.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsDeleteModalOpen(false)}
                      className="flex-1 py-2.5 rounded-xl border border-border text-on-surface font-bold hover:bg-surface-variant transition-colors"
                    >
                      아니오
                    </button>
                    <button
                      onClick={() => setDeleteConfirmStep("PASSWORD")}
                      className="flex-1 py-2.5 rounded-xl bg-error text-on-error font-bold hover:opacity-90 transition-opacity"
                    >
                      예, 삭제하겠습니다
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-on-surface mb-3 font-semibold">
                    완전 초기화를 위해 비밀번호를 입력해 주세요:
                  </p>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="비밀번호 입력..."
                    className="w-full px-4 py-2 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-error/50 mb-3"
                    autoFocus
                  />
                  {deleteError && <p className="text-xs text-error font-bold mb-3">{deleteError}</p>}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setIsDeleteModalOpen(false);
                        setDeletePassword("");
                        setDeleteError("");
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-border text-on-surface font-bold hover:bg-surface-variant transition-colors"
                    >
                      취소
                    </button>
                    <button
                      onClick={handlePurgeAllData}
                      className="flex-1 py-2.5 rounded-xl bg-error text-on-error font-bold hover:opacity-90 transition-opacity"
                    >
                      완전 삭제 확인
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chain Setup Modal */}
      <AnimatePresence>
        {isChainSetupModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setIsChainSetupModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-surface w-full max-w-xl rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col border border-border"
            >
              <div className="flex justify-between items-center p-6 border-b border-border flex-shrink-0">
                <h2 className="font-headline text-xl font-bold flex items-center gap-2 text-primary">
                  <GitMerge className="w-5 h-5" />
                  기존 업무 연쇄 설정
                </h2>
                <button
                  onClick={() => setIsChainSetupModalOpen(false)}
                  className="p-2 hover:bg-surface-variant rounded-full text-on-surface-variant"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4">
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  연쇄적으로 연결할 일정을 순서대로 클릭해 주세요. 선택한 순서대로 <strong>선행 업무 ➔ 후속 업무</strong>의 순서로 연결 체인이 생성됩니다.
                </p>

                {/* Sorting Controls */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setChainSortKey("deadline")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      chainSortKey === "deadline"
                        ? "bg-primary text-on-primary border-primary shadow-sm"
                        : "bg-surface border-border text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    일정 순서 순
                  </button>
                  <button
                    type="button"
                    onClick={() => setChainSortKey("title")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      chainSortKey === "title"
                        ? "bg-primary text-on-primary border-primary shadow-sm"
                        : "bg-surface border-border text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    제목순
                  </button>
                </div>

                {/* Task List */}
                <div className="flex-1 min-h-[250px] max-h-[40vh] overflow-y-auto border border-border rounded-xl p-2 space-y-1.5 bg-background/50">
                  {tasks.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-on-surface-variant/60">
                      등록된 일정이 없습니다.
                    </div>
                  ) : (
                    [...tasks]
                      .sort((a, b) => {
                        if (chainSortKey === "title") {
                          return a.title.localeCompare(b.title);
                        } else {
                          return parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime();
                        }
                      })
                      .map((task) => {
                        const selectionIndex = selectedChainTasks.indexOf(task.id);
                        const isSelected = selectionIndex !== -1;

                        return (
                          <div
                            key={task.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedChainTasks(prev => prev.filter(id => id !== task.id));
                              } else {
                                setSelectedChainTasks(prev => [...prev, task.id]);
                              }
                            }}
                            className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-all ${
                              isSelected
                                ? "bg-primary-container/20 border-primary shadow-sm"
                                : "bg-surface border-border hover:bg-surface-variant"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Sequence Badge / Checkbox */}
                              <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
                                  isSelected
                                    ? "bg-primary border-primary text-on-primary"
                                    : "border-border bg-background"
                                }`}
                              >
                                {isSelected ? selectionIndex + 1 : ""}
                              </div>

                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <TaskBadge type={task.type} />
                                  <span className="font-bold text-xs text-on-surface line-clamp-1">{task.title}</span>
                                </div>
                                <span className="text-[10px] text-on-surface-variant font-medium mt-1">
                                  일정: {format(parseISO(task.deadline), "yyyy년 MM월 dd일 HH:mm", { locale: ko })}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>

                {/* Selected Sequence visualization */}
                {selectedChainTasks.length > 0 && (
                  <div className="p-3 bg-surface-variant/30 border border-border rounded-xl">
                    <span className="text-[10px] font-bold text-on-surface-variant block mb-2">설정할 연쇄 업무 경로 미리보기:</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedChainTasks.map((id, index) => {
                        const t = tasks.find(x => x.id === id);
                        if (!t) return null;
                        return (
                          <React.Fragment key={id}>
                            <div className="px-2.5 py-1 bg-primary text-on-primary rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                                {index + 1}
                              </span>
                              <span className="max-w-[100px] truncate">{t.title}</span>
                            </div>
                            {index < selectedChainTasks.length - 1 && (
                              <ArrowRight className="w-3.5 h-3.5 text-on-surface-variant/60" />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 p-6 border-t border-border flex-shrink-0 bg-surface">
                <button
                  type="button"
                  onClick={() => setIsChainSetupModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border font-bold hover:bg-surface-variant transition-colors text-xs"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveChain}
                  disabled={selectedChainTasks.length < 2}
                  className={`flex-1 py-2.5 rounded-xl font-bold transition-all shadow-sm text-xs ${
                    selectedChainTasks.length >= 2
                      ? "bg-primary text-on-primary hover:opacity-90 cursor-pointer"
                      : "bg-surface-variant text-on-surface-variant/50 border border-border cursor-not-allowed"
                  }`}
                >
                  아래 연쇄 업무로 설정하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Subcomponents

function NavItem({
  icon,
  label,
  isActive,
  onClick,
  isCollapsed = false,
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isCollapsed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={`w-full flex items-center ${isCollapsed ? "justify-center px-2" : "gap-3 px-4"} py-3 rounded-xl transition-colors font-medium ${
        isActive ? "bg-primary-container text-on-primary-container font-bold" : "text-on-surface-variant hover:bg-surface-variant"
      }`}
    >
      {icon}
      {!isCollapsed && <span>{label}</span>}
    </button>
  );
}

function MobileNavItem({
  icon,
  isActive,
  onClick,
}: {
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl transition-colors ${
        isActive ? "text-primary bg-primary-container/50" : "text-on-surface-variant"
      }`}
    >
      {icon}
    </button>
  );
}

function TaskBadge({ type }: { type: TaskType }) {
  const config = {
    MEETING: { label: "미팅", classes: "bg-primary-container text-primary font-bold" },
    BID: { label: "입찰", classes: "bg-error-container text-error font-bold" },
    SUBMISSION: { label: "업무 제출", classes: "bg-tertiary-container text-tertiary font-bold" },
    GENERAL: { label: "일반", classes: "bg-surface-variant text-on-surface-variant" },
    HOLIDAY: { label: "휴일", classes: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold" },
    COMPANY_HOLIDAY: { label: "지정연차", classes: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-bold" },
    PERSONAL_LEAVE: { label: "연차/휴가", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 font-bold" },
  };
  const { label, classes } = config[type] || { label: "일반", classes: "bg-surface-variant text-on-surface-variant" };

  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] uppercase tracking-wider ${classes}`}>
      {label}
    </span>
  );
}

function TaskColumn({
  title,
  tasks,
  onUpdateStatus,
  onEditTask,
  onRescheduleTask,
  status,
  accent,
}: {
  title: string;
  tasks: Task[];
  onUpdateStatus: (id: string, s: TaskStatus) => void;
  onEditTask: (t: Task) => void;
  onRescheduleTask?: (t: Task) => void;
  status: TaskStatus;
  accent: string;
}) {
  return (
    <div className="flex flex-col bg-surface-variant/30 rounded-2xl p-4 h-full min-h-[280px] sm:min-h-0 overflow-hidden border border-border/50">
      <div className="flex items-center gap-2 mb-4 px-2">
        <div className={`w-3 h-3 rounded-full ${accent}`} />
        <h3 className="font-headline font-bold text-lg">{title}</h3>
        <span className="ml-auto bg-surface border border-border text-on-surface-variant text-xs px-2 py-1 rounded-full font-bold">
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onEditTask(task)}
            className="bg-surface p-4 rounded-xl shadow-sm border border-border hover:border-primary/50 cursor-pointer group relative transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <TaskBadge type={task.type} />
            </div>
            <h4 className={`font-bold text-base mb-2 ${task.status === "DONE" ? "line-through text-on-surface-variant opacity-70" : ""}`}>
              {task.title}
            </h4>
            {task.description && <p className="text-sm text-on-surface-variant line-clamp-2 mb-3">{task.description}</p>}

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
              <div className="text-xs text-on-surface-variant flex items-center gap-1 font-medium bg-background px-1.5 py-0.5 rounded border border-border">
                <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                {task.startDate && task.endDate && !isSameDay(parseISO(task.startDate), parseISO(task.endDate)) ? (
                  <span>
                    {format(parseISO(task.startDate), "MM/dd")} ~ {format(parseISO(task.endDate), "MM/dd")}
                  </span>
                ) : (
                  <span>{format(parseISO(task.deadline), "MM/dd HH:mm")}</span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {status === "TODO" && (
                  <button
                    onClick={() => onUpdateStatus(task.id, "DONE")}
                    className="p-1 hover:bg-surface-variant rounded text-primary"
                    title="완료 처리"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                {status === "IN_PROGRESS" && (
                  <button
                    onClick={() => onUpdateStatus(task.id, "DONE")}
                    className="p-1 hover:bg-surface-variant rounded text-primary"
                    title="완료 처리"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                {status === "DONE" && (
                  <>
                    {getTaskTimePeriod(task) === "BEFORE" && (
                      <button
                        onClick={() => onUpdateStatus(task.id, "TODO")}
                        className="p-1 hover:bg-surface-variant rounded text-on-surface-variant"
                        title="해야 할 일로 복원"
                      >
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                    )}
                    {getTaskTimePeriod(task) === "DURING" && (
                      <button
                        onClick={() => onUpdateStatus(task.id, "IN_PROGRESS")}
                        className="p-1 hover:bg-surface-variant rounded text-tertiary"
                        title="진행 중으로 복원"
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    )}
                    {getTaskTimePeriod(task) === "AFTER" && (
                      <button
                        onClick={() => onRescheduleTask?.(task)}
                        className="p-1 hover:bg-surface-variant rounded text-error"
                        title="진행 중으로 복원 및 일정 변경"
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="h-32 flex items-center justify-center border-2 border-dashed border-border rounded-xl text-on-surface-variant text-sm font-medium">
            작업이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

const TASK_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#64748b",
];

function TaskForm({
  initialData,
  tasks,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initialData?: Task | null;
  tasks: Task[];
  onSubmit: (t: Omit<Task, "id" | "createdAt">) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [type, setType] = useState<TaskType>(initialData?.type || "GENERAL");

  const initStart = initialData?.startDate ? parseISO(initialData.startDate) : (initialData?.deadline ? parseISO(initialData.deadline) : new Date());
  const initEnd = initialData?.endDate ? parseISO(initialData.endDate) : (initialData?.deadline ? parseISO(initialData.deadline) : new Date());
  
  const [startDateStr, setStartDateStr] = useState(format(initStart, "yyyy-MM-dd"));
  const [startTimeStr, setStartTimeStr] = useState(format(initStart, "HH:mm"));
  const [endDateStr, setEndDateStr] = useState(format(initEnd, "yyyy-MM-dd"));
  const [endTimeStr, setEndTimeStr] = useState(format(initEnd, "HH:mm"));

  // Toggle for all-day events
  const [isAllDay, setIsAllDay] = useState(() => {
    if (initialData?.startDate && initialData?.endDate) {
      const start = parseISO(initialData.startDate);
      const end = parseISO(initialData.endDate);
      const startHMs = format(start, "HH:mm");
      const endHMs = format(end, "HH:mm");
      return startHMs === "00:00" && (endHMs === "23:59" || endHMs === "00:00");
    }
    return false;
  });

  // Toggle for active end date/time (b & c tasks)
  const [useEndDateTime, setUseEndDateTime] = useState(() => {
    if (initialData?.startDate && initialData?.endDate) {
      const start = parseISO(initialData.startDate);
      const end = parseISO(initialData.endDate);
      const startHMs = format(start, "HH:mm");
      const endHMs = format(end, "HH:mm");
      const isAllDayVal = startHMs === "00:00" && (endHMs === "23:59" || endHMs === "00:00");
      if (isAllDayVal) {
        return format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd");
      }
      return initialData.startDate !== initialData.endDate;
    }
    return false;
  });
  
  const [desc, setDesc] = useState(initialData?.description || "");
  const [color, setColor] = useState(initialData?.color || TASK_COLORS[0]);
  
  // Recurrence
  const [recurrence, setRecurrence] = useState<RecurrenceType>(initialData?.recurrence || "NONE");

  // Chain settings
  const [nextTaskId, setNextTaskId] = useState<string>(initialData?.nextTaskId || "");
  const [prevTaskId, setPrevTaskId] = useState<string>(initialData?.prevTaskId || "");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sync state with initialData when it changes
  useEffect(() => {
    setTitle(initialData?.title || "");
    setType(initialData?.type || "GENERAL");
    
    const start = initialData?.startDate ? parseISO(initialData.startDate) : (initialData?.deadline ? parseISO(initialData.deadline) : new Date());
    const end = initialData?.endDate ? parseISO(initialData.endDate) : (initialData?.deadline ? parseISO(initialData.deadline) : new Date());
    
    setStartDateStr(format(start, "yyyy-MM-dd"));
    setStartTimeStr(format(start, "HH:mm"));
    setEndDateStr(format(end, "yyyy-MM-dd"));
    setEndTimeStr(format(end, "HH:mm"));

    let isAllDayVal = false;
    if (initialData?.startDate && initialData?.endDate) {
      const s = parseISO(initialData.startDate);
      const e = parseISO(initialData.endDate);
      isAllDayVal = format(s, "HH:mm") === "00:00" && (format(e, "HH:mm") === "23:59" || format(e, "HH:mm") === "00:00");
    }
    setIsAllDay(isAllDayVal);

    let hasDifferentDates = false;
    if (initialData?.startDate && initialData?.endDate) {
      if (isAllDayVal) {
        hasDifferentDates = format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd");
      } else {
        hasDifferentDates = initialData.startDate !== initialData.endDate;
      }
    }
    setUseEndDateTime(hasDifferentDates);
    setDesc(initialData?.description || "");
    setColor(initialData?.color || TASK_COLORS[0]);
    setRecurrence(initialData?.recurrence || "NONE");
    setNextTaskId(initialData?.nextTaskId || "");
    setPrevTaskId(initialData?.prevTaskId || "");
    setShowDeleteConfirm(false);
  }, [initialData]);

  const handleStartChange = (newDateStr: string, newTimeStr: string) => {
    const currentStart = new Date(`${startDateStr}T${startTimeStr}`);
    const currentEnd = new Date(`${endDateStr}T${endTimeStr}`);
    const durationMs = currentEnd.getTime() - currentStart.getTime();

    setStartDateStr(newDateStr);
    setStartTimeStr(newTimeStr);

    if (useEndDateTime) {
      const newStart = new Date(`${newDateStr}T${newTimeStr}`);
      const newEnd = new Date(newStart.getTime() + (durationMs > 0 ? durationMs : 60 * 60 * 1000));
      setEndDateStr(format(newEnd, "yyyy-MM-dd"));
      setEndTimeStr(format(newEnd, "HH:mm"));
    } else {
      setEndDateStr(newDateStr);
      setEndTimeStr(newTimeStr);
    }
  };

  const handleEndChange = (newDateStr: string, newTimeStr: string) => {
    const start = new Date(`${startDateStr}T${startTimeStr}`);
    const newEnd = new Date(`${newDateStr}T${newTimeStr}`);
    
    if (newEnd.getTime() < start.getTime()) {
      setEndDateStr(startDateStr);
      setEndTimeStr(startTimeStr);
    } else {
      setEndDateStr(newDateStr);
      setEndTimeStr(newTimeStr);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const sTime = isAllDay ? "00:00" : startTimeStr;
    const eTime = isAllDay ? "23:59" : endTimeStr;

    const startISO = new Date(`${startDateStr}T${sTime}`).toISOString();
    const endISO = (useEndDateTime || isAllDay)
      ? new Date(`${endDateStr}T${eTime}`).toISOString()
      : startISO;

    onSubmit({
      title,
      type,
      deadline: endISO, // compatibility fallback
      startDate: startISO,
      endDate: endISO,
      status: initialData?.status || "TODO",
      description: desc,
      color,
      recurrence,
      nextTaskId: nextTaskId || undefined,
      prevTaskId: prevTaskId || undefined,
      completedAt: initialData?.completedAt,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 sm:p-5 flex flex-col gap-3.5 overflow-y-auto sm:overflow-y-hidden flex-1 text-sm max-w-full cell-scroll">
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <label className="block text-xs font-bold mb-1">일정 제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="프로젝트 A 입찰 서류 제출..."
            className="w-full px-3 py-2 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm min-h-[48px]"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold mb-1">유형</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
            className="w-full px-3 py-2 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm min-h-[48px]"
          >
             <option value="GENERAL">일반</option>
            <option value="MEETING">미팅</option>
            <option value="BID">입찰</option>
            <option value="SUBMISSION">업무 제출</option>
            <option value="HOLIDAY">휴일</option>
            <option value="COMPANY_HOLIDAY">지정연차</option>
            <option value="PERSONAL_LEAVE">연차/휴가</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold mb-1">반복 주기설정</label>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as RecurrenceType)}
            className="w-full px-3 py-2 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm min-h-[48px]"
          >
            <option value="NONE">반복 없음</option>
            <option value="WEEKLY">매주 반복</option>
            <option value="MONTHLY">매월 반복</option>
            <option value="QUARTERLY">매분기 반복</option>
            <option value="SEMI_ANNUALLY">매반기 반복</option>
            <option value="ANNUALLY">매년 반복 (정기 업무)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold mb-1">색상 지정</label>
          <div className="flex flex-wrap gap-1 py-1">
            {TASK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center transition-transform ${
                  color === c ? "scale-110 ring-2 ring-on-surface" : "hover:scale-105 opacity-80"
                }`}
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="w-3.5 h-3.5 text-white drop-shadow-md" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2 sm:p-3 bg-surface-variant/30 border border-border/60 rounded-xl">
        <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5 border-b border-border/40 pb-1.5">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useEndDateTime"
              checked={useEndDateTime}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseEndDateTime(checked);
                if (!checked) {
                  setEndDateStr(startDateStr);
                  setEndTimeStr(startTimeStr);
                } else {
                  const start = new Date(`${startDateStr}T${startTimeStr}`);
                  const end = new Date(start.getTime() + 60 * 60 * 1000);
                  setEndDateStr(format(end, "yyyy-MM-dd"));
                  setEndTimeStr(format(end, "HH:mm"));
                }
              }}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
            />
            <label htmlFor="useEndDateTime" className="text-xs font-bold select-none cursor-pointer text-on-surface">
              종료 날짜 / 시간 설정 활성화
            </label>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAllDay"
              checked={isAllDay}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsAllDay(checked);
                if (checked) {
                  setStartTimeStr("00:00");
                  setEndTimeStr("23:59");
                } else {
                  const now = new Date();
                  setStartTimeStr(format(now, "HH:mm"));
                  setEndTimeStr(format(now, "HH:mm"));
                }
              }}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
            />
            <label htmlFor="isAllDay" className="text-xs font-bold select-none cursor-pointer text-on-surface">
              하루종일 (시간 설정 비활성화)
            </label>
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1 text-primary">시작 날짜 / 시간</label>
          <div className="flex gap-1.5">
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => handleStartChange(e.target.value, startTimeStr)}
              className="w-full px-2 py-1.5 rounded-lg border border-border bg-surface text-xs focus:outline-none"
              required
            />
            <input
              type="time"
              value={startTimeStr}
              onChange={(e) => handleStartChange(startDateStr, e.target.value)}
              className={`w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none ${
                isAllDay ? "bg-surface-variant/30 text-on-surface-variant/50 cursor-not-allowed" : "bg-surface text-on-surface"
              }`}
              disabled={isAllDay}
              required={!isAllDay}
            />
          </div>
        </div>
        <div>
          <label className={`block text-xs font-bold mb-1 ${useEndDateTime ? "text-error" : "text-on-surface-variant/50"}`}>
            종료 날짜 / 시간
          </label>
          <div className="flex gap-1.5">
            <input
              type="date"
              value={endDateStr}
              onChange={(e) => handleEndChange(e.target.value, endTimeStr)}
              className={`w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none ${
                useEndDateTime ? "bg-surface text-on-surface" : "bg-surface-variant/30 text-on-surface-variant/50 cursor-not-allowed"
              }`}
              disabled={!useEndDateTime}
              required={useEndDateTime}
            />
            <input
              type="time"
              value={endTimeStr}
              onChange={(e) => handleEndChange(endDateStr, e.target.value)}
              className={`w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none ${
                (!useEndDateTime || isAllDay) ? "bg-surface-variant/30 text-on-surface-variant/50 cursor-not-allowed" : "bg-surface text-on-surface"
              }`}
              disabled={!useEndDateTime || isAllDay}
              required={useEndDateTime && !isAllDay}
            />
          </div>
        </div>
      </div>

      {/* Dependency Link UI */}
      <div className="p-3 bg-surface-variant/30 border border-border/60 rounded-xl flex flex-col gap-2">
        <span className="text-xs font-bold text-on-surface-variant flex items-center gap-1">
          <GitMerge className="w-3.5 h-3.5 text-primary" /> 연쇄 업무 설정
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant mb-0.5">선행 업무 (이전 단계)</label>
            <select
              value={prevTaskId}
              onChange={(e) => setPrevTaskId(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-lg border border-border bg-surface focus:outline-none min-h-[40px] sm:min-h-[auto]"
            >
              <option value="">없음 (시작 업무)</option>
              {tasks
                .filter(t => t.id !== initialData?.id)
                .map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant mb-0.5">후속 업무 (다음 단계)</label>
            <select
              value={nextTaskId}
              onChange={(e) => setNextTaskId(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded-lg border border-border bg-surface focus:outline-none min-h-[40px] sm:min-h-[auto]"
            >
              <option value="">없음 (종료 업무)</option>
              {tasks
                .filter(t => t.id !== initialData?.id)
                .map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold mb-1">상세 내용 (선택)</label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="관련 자료 링크나 참고 사항을 적어주세요."
          className="w-full px-3 py-1.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 text-xs min-h-[60px] resize-none"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-2 pt-3 border-t border-border flex-shrink-0 items-center justify-between">
        {onDelete && (
          <div className="w-full sm:w-auto">
            {showDeleteConfirm ? (
              <div className="flex items-center justify-between gap-2 bg-error-container/30 px-3 h-[42px] rounded-xl border border-error/50 w-full whitespace-nowrap">
                <span className="text-xs font-bold text-error">삭제하시겠습니까?</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={onDelete} className="text-error hover:underline text-xs font-bold px-1.5 py-0.5 rounded bg-error-container/50">네</button>
                  <button type="button" onClick={() => setShowDeleteConfirm(false)} className="text-on-surface-variant hover:underline text-xs px-1.5 py-0.5 rounded bg-surface">아니오</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="h-[42px] px-3 w-full sm:w-auto rounded-xl border border-error text-error hover:bg-error-container/20 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                <span className="text-xs font-bold">삭제</span>
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button type="button" onClick={onCancel} className="flex-1 sm:w-28 h-[42px] rounded-xl border border-border font-bold hover:bg-surface-variant transition-colors text-xs">
            취소
          </button>
          <button type="submit" className="flex-1 sm:w-36 h-[42px] rounded-xl bg-primary text-on-primary font-bold hover:opacity-90 transition-colors shadow-sm text-xs">
            {initialData ? "저장하기" : "등록하기"}
          </button>
        </div>
      </div>
    </form>
  );
}

interface RescheduleModalProps {
  task: Task;
  tasks: Task[];
  onSave: (taskId: string, dates: { deadline: string; startDate: string; endDate: string }) => void;
  onCancel: () => void;
}

function RescheduleModal({ task, tasks, onSave, onCancel }: RescheduleModalProps) {
  // Default new deadline to 2 days from now (same as before)
  const defaultDate = addDays(new Date(), 2);
  
  const initStart = task.startDate ? parseISO(task.startDate) : (task.deadline ? parseISO(task.deadline) : defaultDate);
  const initEnd = task.endDate ? task.endDate : (task.deadline ? task.deadline : defaultDate.toISOString());

  const [startDateStr, setStartDateStr] = useState(format(initStart, "yyyy-MM-dd"));
  const [startTimeStr, setStartTimeStr] = useState(format(initStart, "HH:mm"));
  const [endDateStr, setEndDateStr] = useState(format(parseISO(initEnd), "yyyy-MM-dd"));
  const [endTimeStr, setEndTimeStr] = useState(format(parseISO(initEnd), "HH:mm"));

  const [isAllDay, setIsAllDay] = useState(() => {
    if (task.startDate && task.endDate) {
      const start = parseISO(task.startDate);
      const end = parseISO(task.endDate);
      const startHMs = format(start, "HH:mm");
      const endHMs = format(end, "HH:mm");
      return startHMs === "00:00" && (endHMs === "23:59" || endHMs === "00:00");
    }
    return false;
  });

  const [useEndDateTime, setUseEndDateTime] = useState(() => {
    if (task.startDate && task.endDate) {
      const start = parseISO(task.startDate);
      const end = parseISO(task.endDate);
      const startHMs = format(start, "HH:mm");
      const endHMs = format(end, "HH:mm");
      const isAllDayVal = startHMs === "00:00" && (endHMs === "23:59" || endHMs === "00:00");
      if (isAllDayVal) {
        return format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd");
      }
      return task.startDate !== task.endDate;
    }
    return false;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const startISO = new Date(`${startDateStr}T${startTimeStr}`).toISOString();
    const endISO = useEndDateTime 
      ? new Date(`${endDateStr}T${endTimeStr}`).toISOString()
      : startISO;

    onSave(task.id, {
      deadline: endISO,
      startDate: startISO,
      endDate: endISO,
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-surface w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col border border-border"
      >
        <div className="flex justify-between items-center p-5 border-b border-border">
          <h2 className="font-headline text-lg font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            일정 연장 및 복원
          </h2>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-surface-variant rounded-full text-on-surface-variant flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 text-sm bg-surface">
          <div>
            <span className="text-xs text-on-surface-variant font-bold block mb-1">선택된 일정</span>
            <div className="p-3 bg-surface-variant/30 rounded-xl font-bold text-base border border-border/50 text-on-surface">
              {task.title}
            </div>
            {task.recurrence && task.recurrence !== "NONE" && (
              <p className="text-xs text-primary/80 mt-1.5 flex items-center gap-1 font-medium">
                ⚠️ 본 기능은 이 단일 일정 하나에만 적용되며, 다른 반복 회차의 마감일은 변경되지 않습니다.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 p-3 bg-surface-variant/20 border border-border/40 rounded-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rescheduleUseEndDateTime"
                  checked={useEndDateTime}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseEndDateTime(checked);
                    if (!checked) {
                      setEndDateStr(startDateStr);
                      setEndTimeStr(startTimeStr);
                    } else {
                      const start = new Date(`${startDateStr}T${startTimeStr}`);
                      const end = new Date(start.getTime() + 60 * 60 * 1000);
                      setEndDateStr(format(end, "yyyy-MM-dd"));
                      setEndTimeStr(format(end, "HH:mm"));
                    }
                  }}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                />
                <label htmlFor="rescheduleUseEndDateTime" className="text-xs font-bold select-none cursor-pointer text-on-surface">
                  종료 날짜 / 시간 활성화
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rescheduleIsAllDay"
                  checked={isAllDay}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsAllDay(checked);
                    if (checked) {
                      setStartTimeStr("00:00");
                      setEndTimeStr("23:59");
                    } else {
                      const now = new Date();
                      setStartTimeStr(format(now, "HH:mm"));
                      setEndTimeStr(format(new Date(now.getTime() + 60 * 60 * 1000), "HH:mm"));
                    }
                  }}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                />
                <label htmlFor="rescheduleIsAllDay" className="text-xs font-bold select-none cursor-pointer text-on-surface">
                  하루종일
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">
                  시작 날짜 / 시간
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={startDateStr}
                    onChange={(e) => {
                      setStartDateStr(e.target.value);
                      if (!useEndDateTime) {
                        setEndDateStr(e.target.value);
                      }
                    }}
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface"
                    required
                  />
                  {!isAllDay && (
                    <input
                      type="time"
                      value={startTimeStr}
                      onChange={(e) => {
                        setStartTimeStr(e.target.value);
                        if (!useEndDateTime) {
                          setEndTimeStr(e.target.value);
                        }
                      }}
                      className="w-28 px-3 py-2 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface"
                      required
                    />
                  )}
                </div>
              </div>

              {useEndDateTime && (
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1">
                    종료 날짜 / 시간
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={endDateStr}
                      onChange={(e) => setEndDateStr(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface"
                      required
                    />
                    {!isAllDay && (
                      <input
                        type="time"
                        value={endTimeStr}
                        onChange={(e) => setEndTimeStr(e.target.value)}
                        className="w-28 px-3 py-2 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface"
                        required
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 justify-end mt-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-[44px] rounded-xl border border-border bg-surface hover:bg-surface-variant/20 font-bold transition-colors text-on-surface"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 h-[44px] rounded-xl bg-primary text-on-primary hover:bg-primary/90 font-bold transition-colors"
            >
              연장 및 저장
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function FullCalendar({
  tasks,
  onEditTask,
  onAddTask,
  selectedDate,
  onSelectDate,
}: {
  tasks: Task[];
  onEditTask: (t: Task) => void;
  onAddTask: (date: Date) => void;
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showSelector, setShowSelector] = useState(false);
  const [selectorMode, setSelectorMode] = useState<"month" | "year">("month");
  const [calendarViewMode, setCalendarViewMode] = useState<"grid" | "list">("grid");
  const [yearPageStart, setYearPageStart] = useState(() => {
    const currentYear = new Date().getFullYear();
    return 2020 + Math.floor((currentYear - 2020) / 12) * 12;
  });

  const [hideWeekends, setHideWeekends] = useState(false);

  // Auto-switch view modes based on window size on mount and resize
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 480) {
        setCalendarViewMode("list");
      } else {
        setCalendarViewMode("grid");
      }
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  const daysToShow = daysInMonth.filter(day => {
    if (hideWeekends) {
      const dayOfWeek = getDay(day);
      return dayOfWeek !== 0 && dayOfWeek !== 6;
    }
    return true;
  });

  const startDay = getDay(monthStart);
  let paddingCount = 0;
  if (hideWeekends) {
    const firstDayOfWeek = getDay(monthStart);
    if (firstDayOfWeek === 0 || firstDayOfWeek === 6) {
      paddingCount = 0;
    } else {
      paddingCount = firstDayOfWeek - 1; // Mon=0, Tue=1, etc.
    }
  } else {
    paddingCount = startDay;
  }
  const paddingDays = Array.from({ length: paddingCount }).map((_, i) => i);

  // Get tasks scheduled on selectedDate
  const selectedDateTasks = selectedDate
    ? tasks.filter((t) => {
        if (t.startDate && t.endDate) {
          const start = startOfDay(parseISO(t.startDate));
          const end = startOfDay(parseISO(t.endDate));
          const target = startOfDay(selectedDate);
          return isWithinInterval(target, { start, end });
        }
        return isSameDay(parseISO(t.deadline), selectedDate);
      })
    : [];

  return (
    <div className="h-full flex flex-col bg-surface-variant/30 rounded-xl overflow-hidden p-2 sm:p-4">
      {/* Calendar Header */}
      <div className="relative flex items-center justify-between mb-3 p-1 flex-shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowSelector(!showSelector);
              setSelectorMode("month");
            }}
            className="font-headline text-lg sm:text-2xl font-bold hover:text-primary transition-colors flex items-center gap-0.5 p-1 rounded-lg hover:bg-surface-variant"
          >
            {format(currentDate, "yyyy년 M월", { locale: ko })}
            <ChevronDown className="w-4 h-4 sm:w-6 h-6" />
          </button>
          <div className="flex gap-0.5">
            <button
              onClick={() => {
                setCurrentDate(subMonths(currentDate, 1));
                onSelectDate(null);
              }}
              className="p-1.5 hover:bg-surface-variant rounded-lg border border-border bg-surface text-on-surface-variant transition-colors"
              title="이전 달"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setCurrentDate(addMonths(currentDate, 1));
                onSelectDate(null);
              }}
              className="p-1.5 hover:bg-surface-variant rounded-lg border border-border bg-surface text-on-surface-variant transition-colors"
              title="다음 달"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* View Toggle Mode */}
          <div className="flex bg-surface border border-border rounded-lg p-0.5 shadow-sm">
            <button
              onClick={() => setCalendarViewMode("grid")}
              className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                calendarViewMode === "grid" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              달력
            </button>
            <button
              onClick={() => setCalendarViewMode("list")}
              className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                calendarViewMode === "list" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              일정목록
            </button>
          </div>

          <button
            onClick={() => setHideWeekends(!hideWeekends)}
            className={`px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all border ${
              hideWeekends
                ? "bg-tertiary text-on-tertiary border-tertiary shadow-sm"
                : "bg-surface border-border text-on-surface-variant hover:bg-surface-variant"
            }`}
          >
            {hideWeekends ? "주말 표시" : "주말 숨김"}
          </button>
        </div>

        {/* Date Selector Popover */}
        <AnimatePresence>
          {showSelector && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 left-2 z-20 bg-surface border border-border shadow-xl rounded-xl p-4 w-72"
            >
              {selectorMode === "month" ? (
                <>
                  <div className="flex justify-between items-center mb-4 px-2">
                    <button
                      onClick={() => {
                        setSelectorMode("year");
                        const year = currentDate.getFullYear();
                        setYearPageStart(2020 + Math.floor((year - 2020) / 12) * 12);
                      }}
                      className="font-bold text-lg hover:text-primary flex items-center gap-1"
                    >
                      {format(currentDate, "yyyy년")}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const newDate = new Date(currentDate);
                          newDate.setMonth(i);
                          setCurrentDate(newDate);
                          onSelectDate(null);
                          setShowSelector(false);
                        }}
                        className={`py-2 rounded-lg font-medium text-sm transition-colors ${
                          currentDate.getMonth() === i ? "bg-primary text-on-primary" : "hover:bg-surface-variant"
                        }`}
                      >
                        {i + 1}월
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-4 px-2">
                    <button onClick={() => setSelectorMode("month")} className="font-bold text-lg hover:text-primary flex items-center gap-1">
                      <ChevronLeft className="w-5 h-5" /> 연도 선택
                    </button>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setYearPageStart((prev) => prev - 12)} className="p-1 hover:bg-surface-variant rounded-md">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setYearPageStart((prev) => prev + 12)} className="p-1 hover:bg-surface-variant rounded-md">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const year = yearPageStart + i;
                      return (
                        <button
                          key={year}
                          onClick={() => {
                            const newDate = new Date(currentDate);
                            newDate.setFullYear(year);
                            setCurrentDate(newDate);
                            onSelectDate(null);
                            setSelectorMode("month");
                          }}
                          className={`py-2 rounded-lg font-medium text-sm transition-colors ${
                            currentDate.getFullYear() === year ? "bg-primary text-on-primary" : "hover:bg-surface-variant"
                          }`}
                        >
                          {year}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main Grid & Timeline Section */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {calendarViewMode === "grid" ? (
          /* Left Side: Calendar Grid */
          <div className="flex flex-col h-full flex-1 min-w-[300px] sm:min-w-[600px] overflow-x-auto">
            <div className={`grid ${hideWeekends ? "grid-cols-5" : "grid-cols-7"} gap-1 sm:gap-2 text-center text-xs sm:text-sm font-bold mb-2 p-1 flex-shrink-0`}>
              {!hideWeekends && <div className="text-red-500">일</div>}
              <div className="text-on-surface-variant">월</div>
              <div className="text-on-surface-variant">화</div>
              <div className="text-on-surface-variant">수</div>
              <div className="text-on-surface-variant">목</div>
              <div className="text-on-surface-variant">금</div>
              {!hideWeekends && <div className="text-blue-500">토</div>}
            </div>

            <div className={`grid ${hideWeekends ? "grid-cols-5" : "grid-cols-7"} gap-1 sm:gap-2 flex-1 auto-rows-[minmax(90px,_1fr)] sm:auto-rows-[minmax(115px,_1fr)] overflow-y-auto pr-1 pb-2 px-1 cell-scroll`}>
              {paddingDays.map((i) => (
                <div key={`pad-${i}`} className="p-1 rounded-lg bg-surface/30" />
              ))}
              {daysToShow.map((day) => {
                const isT = isToday(day);
                const isSel = selectedDate && isSameDay(day, selectedDate);
                const dayOfWeek = getDay(day);
                const isSun = dayOfWeek === 0;
                const isSat = dayOfWeek === 6;
                const dayTasks = tasks.filter((t) => {
                  if (t.startDate && t.endDate) {
                    const start = startOfDay(parseISO(t.startDate));
                    const end = startOfDay(parseISO(t.endDate));
                    const target = startOfDay(day);
                    return isWithinInterval(target, { start, end });
                  }
                  return isSameDay(parseISO(t.deadline), day);
                });

                dayTasks.sort((a, b) => {
                  const getDuration = (t: Task) => {
                    if (t.startDate && t.endDate) {
                      const start = startOfDay(parseISO(t.startDate));
                      const end = startOfDay(parseISO(t.endDate));
                      return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                    }
                    return 1;
                  };
                  const durA = getDuration(a);
                  const durB = getDuration(b);
                  if (durA !== durB) {
                    return durB - durA;
                  }
                  return a.title.localeCompare(b.title);
                });

                return (
                  <div
                    key={day.toString()}
                    onClick={() => {
                      onSelectDate(isSel ? null : day);
                    }}
                    className={`p-1.5 sm:p-2.5 rounded-xl bg-surface border ${
                      isT ? "border-primary shadow-sm" : isSel ? "border-tertiary ring-2 ring-tertiary/20" : "border-border"
                    } flex flex-col min-h-[90px] sm:min-h-[115px] overflow-hidden cursor-pointer hover:border-primary/50 transition-all`}
                  >
                    <div className={`text-xs sm:text-base font-bold mb-1.5 flex items-center justify-between ${
                      isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-on-surface"
                    }`}>
                      <span>{format(day, "d")}</span>
                      {isT && (
                        <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-on-primary">오늘</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1.5 cell-scroll hidden sm:block">
                      {dayTasks.map((t) => (
                        <div
                          key={t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditTask(t);
                          }}
                          style={{ backgroundColor: t.color || "#4a7c59" }}
                          className="text-white text-xs sm:text-[13px] font-semibold px-2 py-1 rounded-md truncate leading-snug shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                          title={t.title}
                        >
                          <span className={t.status === "DONE" ? "line-through opacity-75" : ""}>{t.title}</span>
                        </div>
                      ))}
                    </div>
                    {/* Tiny dots indicator for mobile views */}
                    <div className="flex flex-wrap gap-0.5 mt-auto sm:hidden">
                      {dayTasks.slice(0, 3).map((t) => (
                        <span
                          key={t.id}
                          style={{ backgroundColor: t.color || "#4a7c59" }}
                          className="w-1.5 h-1.5 rounded-full inline-block"
                        />
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="text-[7px] leading-[6px] font-bold text-on-surface-variant">+</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* List View / Timeline Mode for Z Fold 7 Cover Screen */
          <div className="flex-1 flex flex-col overflow-y-auto px-1 space-y-3 pb-36 h-auto cell-scroll">
            {daysToShow.map((day) => {
              const isT = isToday(day);
              const dayOfWeek = getDay(day);
              const isSun = dayOfWeek === 0;
              const isSat = dayOfWeek === 6;
              const dayTasks = tasks.filter((t) => {
                if (t.startDate && t.endDate) {
                  const start = startOfDay(parseISO(t.startDate));
                  const end = startOfDay(parseISO(t.endDate));
                  const target = startOfDay(day);
                  return isWithinInterval(target, { start, end });
                }
                return isSameDay(parseISO(t.deadline), day);
              });

              const isSel = selectedDate && isSameDay(day, selectedDate);

              return (
                <div
                  key={day.toString()}
                  onClick={() => onSelectDate(isSel ? null : day)}
                  className={`bg-surface rounded-xl border p-3 flex flex-col gap-2 shadow-sm cursor-pointer transition-all ${
                    isSel ? "border-tertiary ring-2 ring-tertiary/20" : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2" onClick={() => onSelectDate(isSel ? null : day)}>
                      <span className={`text-base font-black ${isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-primary"}`}>
                        {format(day, "M/d")}
                      </span>
                      <span className="text-xs font-bold text-on-surface-variant">
                        ({format(day, "E", { locale: ko })})
                      </span>
                      {isT && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-on-primary">오늘</span>
                      )}
                    </div>
                    <button
                      onClick={() => onAddTask(day)}
                      className="p-1.5 hover:bg-primary-container/30 text-primary rounded-full transition-colors flex items-center justify-center min-h-[40px] min-w-[40px]"
                      title="이 날에 일정 추가"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {dayTasks.map((t) => {
                      const startTime = t.startDate ? format(parseISO(t.startDate), "HH:mm") : "";
                      const endTime = t.endDate ? format(parseISO(t.endDate), "HH:mm") : "";
                      return (
                        <div
                          key={t.id}
                          onClick={() => onEditTask(t)}
                          style={{ borderLeftColor: t.color || "#4a7c59" }}
                          className="p-3 rounded-lg border border-border/60 bg-surface-variant/20 hover:bg-surface-variant/40 cursor-pointer transition-all border-l-4 flex items-center justify-between gap-2 min-h-[48px]"
                        >
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[10px] font-bold text-on-surface-variant">
                              {startTime ? `${startTime} ~ ${endTime}` : "종일"}
                            </span>
                            <h4 className={`font-bold text-xs text-on-surface truncate ${t.status === "DONE" ? "line-through opacity-50" : ""}`}>
                              {t.title}
                            </h4>
                          </div>
                          <TaskBadge type={t.type} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {tasks.filter((t) => {
              const start = startOfMonth(currentDate);
              const end = endOfMonth(currentDate);
              const deadline = parseISO(t.deadline);
              return isWithinInterval(deadline, { start, end });
            }).length === 0 && (
              <div className="py-12 text-center text-xs text-on-surface-variant/50 border border-dashed border-border rounded-xl">
                이 달에 등록된 일정이 없습니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Option A: Slide-over Drawer with Backdrop */}
        <AnimatePresence>
          {selectedDate && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onSelectDate(null)}
                className="absolute inset-0 bg-black/20 z-20 will-change-[opacity]"
              />
              {/* Drawer */}
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "tween", ease: "easeOut", duration: 0.25 }}
                className="absolute right-0 top-0 bottom-0 w-full sm:w-[380px] md:w-[420px] bg-surface z-30 border-l border-border flex flex-col shadow-2xl h-full will-change-transform"
              >
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0 bg-surface">
                  <h3 className="font-headline font-bold text-sm sm:text-base text-primary flex items-center gap-1.5">
                    <CalendarIcon className="w-5 h-5" />
                    {format(selectedDate, "M월 d일 (E) 일정", { locale: ko })}
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        onAddTask(selectedDate);
                      }}
                      className="p-1.5 hover:bg-primary-container/30 hover:text-primary rounded-full text-on-surface-variant transition-colors flex items-center justify-center min-h-[40px] min-w-[40px]"
                      title="일정 추가"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => onSelectDate(null)}
                      className="p-1.5 hover:bg-surface-variant rounded-full text-on-surface-variant transition-colors flex items-center justify-center min-h-[40px] min-w-[40px]"
                      title="닫기"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Agenda List Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-background/20 cell-scroll">
                  {selectedDateTasks.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-xs text-on-surface-variant/50 border-2 border-dashed border-border/80 rounded-xl bg-surface/50 p-4">
                      <CalendarIcon className="w-8 h-8 mb-2 opacity-30 text-on-surface-variant" />
                      <p className="font-bold">해당 날짜에 등록된 일정이 없습니다.</p>
                      <p className="text-[10px] mt-1 text-on-surface-variant/80">캘린더 빈칸을 더블 클릭해 새로운 일정을 등록해 보세요.</p>
                    </div>
                  ) : (
                    (() => {
                      const sortedSelectedDateTasks = [...selectedDateTasks].sort((a, b) => {
                        const aTime = a.startDate ? parseISO(a.startDate).getTime() : parseISO(a.deadline).getTime();
                        const bTime = b.startDate ? parseISO(b.startDate).getTime() : parseISO(b.deadline).getTime();
                        return aTime - bTime;
                      });

                      return sortedSelectedDateTasks.map((t) => {
                        const startTime = t.startDate ? format(parseISO(t.startDate), "HH:mm") : "";
                        const endTime = t.endDate ? format(parseISO(t.endDate), "HH:mm") : "";
                        const isAllDayEvent = t.startDate && t.endDate && (
                          format(parseISO(t.startDate), "HH:mm") === "00:00" &&
                          (format(parseISO(t.endDate), "HH:mm") === "23:59" || format(parseISO(t.endDate), "HH:mm") === "00:00")
                        );

                        return (
                          <div
                            key={t.id}
                            onClick={() => onEditTask(t)}
                            style={{ borderLeftColor: t.color || "#4a7c59" }}
                            className="p-4 rounded-xl border border-border bg-surface hover:bg-surface-variant/40 cursor-pointer transition-all border-l-4 shadow-sm hover:shadow-md flex flex-col gap-2.5 group"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-on-surface-variant flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-primary" />
                                {isAllDayEvent ? "하루종일" : (startTime && endTime ? `${startTime} - ${endTime}` : format(parseISO(t.deadline), "HH:mm"))}
                              </span>
                              <TaskBadge type={t.type} />
                            </div>
                            <h4 className={`font-bold text-sm text-on-surface ${t.status === "DONE" ? "line-through opacity-60 text-on-surface-variant" : ""}`}>
                              {t.title}
                            </h4>
                            {t.description && (
                              <p className="text-[11px] text-on-surface-variant/80 bg-background/50 p-2 rounded-lg border border-border/50 font-medium whitespace-pre-line leading-relaxed">
                                {t.description}
                              </p>
                            )}
                          </div>
                        );
                      });
                    })()
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
    </div>
  );
}

function PeriodicTable({
  tasks,
  onEdit,
  onStatusUpdate,
}: {
  tasks: Task[];
  onEdit: (t: Task) => void;
  onStatusUpdate: (id: string, s: TaskStatus) => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-on-surface-variant/60 border border-dashed border-border rounded-xl">
        설정된 정기 업무 일정이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="bg-surface-variant/50 border-b border-border text-xs font-bold text-on-surface-variant">
            <th className="p-3">업무명</th>
            <th className="p-3">업무구분</th>
            <th className="p-3">예정 시점</th>
            <th className="p-3">현재 상태</th>
            <th className="p-3 text-right">관리</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b border-border/40 hover:bg-surface-variant/20 transition-colors">
              <td className="p-3 font-bold text-on-surface">{task.title}</td>
              <td className="p-3"><TaskBadge type={task.type} /></td>
              <td className="p-3 font-medium text-xs text-on-surface-variant">
                {format(parseISO(task.deadline), "yyyy년 MM월 dd일", { locale: ko })}
              </td>
              <td className="p-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  task.status === "DONE" ? "bg-primary-container text-primary" : "bg-surface-variant text-on-surface-variant"
                }`}>
                  {task.status === "DONE" ? "완료" : task.status === "IN_PROGRESS" ? "진행중" : "예정(대기)"}
                </span>
              </td>
              <td className="p-3 text-right">
                <div className="inline-flex gap-1.5">
                  <button
                    onClick={() => onStatusUpdate(task.id, task.status === "DONE" ? "TODO" : "DONE")}
                    className="px-2.5 py-1 text-[10px] font-bold rounded bg-surface border border-border hover:bg-primary-container/20 transition-colors"
                  >
                    {task.status === "DONE" ? "다시 활성화" : "완료 처리"}
                  </button>
                  <button
                    onClick={() => onEdit(task)}
                    className="px-2.5 py-1 text-[10px] font-bold rounded bg-primary text-on-primary hover:opacity-90 transition-colors"
                  >
                    상세보기
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
