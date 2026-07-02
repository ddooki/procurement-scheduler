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
} from "date-fns";
import { ko } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";

type TaskType = "MEETING" | "BID" | "SUBMISSION" | "GENERAL";
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

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
}

const STORAGE_KEY = "outsourcing_team_schedule_data";

export default function App() {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "tasks" | "calendar" | "settings"
  >("dashboard");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize from localStorage
  useEffect(() => {
    const initialize = () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.tasks) {
            // 30일이 지난 완료된 일정 삭제
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const validTasks = parsed.tasks.filter((t: Task) => {
              if (t.status === "DONE") {
                const compareDate = t.completedAt
                  ? parseISO(t.completedAt)
                  : parseISO(t.deadline);
                return isAfter(compareDate, thirtyDaysAgo);
              }
              return true;
            });
            setTasks(validTasks);
          }
          if (parsed.theme === "dark") {
            setIsDarkMode(true);
            document.documentElement.classList.add("dark");
          }
        } catch (e) {
          console.error("Failed to parse saved data");
        }
      }
      setLastSaved(new Date());
      setIsLoading(false);
    };

    const timer = setTimeout(initialize, 0);
    return () => clearTimeout(timer);
  }, []);

  // Save to localStorage whenever tasks change
  useEffect(() => {
    if (isLoading) return;
    const data = {
      tasks,
      theme: isDarkMode ? "dark" : "light",
      lastSaved: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    const timer = setTimeout(() => {
      setLastSaved(new Date());
    }, 0);
    return () => clearTimeout(timer);
  }, [tasks, isDarkMode, isLoading]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    if (newTheme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleExportData = () => {
    const data = {
      tasks,
      theme: isDarkMode ? "dark" : "light",
      exportedAt: new Date().toISOString(),
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = format(new Date(), "yyyyMMdd_HHmmss");
    a.download = `외주구매팀_업무관리표_${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.tasks) {
          setTasks(parsed.tasks);
          if (parsed.theme === "dark") {
            setIsDarkMode(true);
            document.documentElement.classList.add("dark");
          } else {
            setIsDarkMode(false);
            document.documentElement.classList.remove("dark");
          }
          alert("데이터를 성공적으로 불러왔습니다.");
        }
      } catch (error) {
        alert("잘못된 파일 형식입니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset
  };

  const handleSaveTask = (taskData: Omit<Task, "id" | "createdAt">) => {
    if (editingTask) {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === editingTask.id) {
            return {
              ...t,
              ...taskData,
              completedAt:
                taskData.status === "DONE" && t.status !== "DONE"
                  ? new Date().toISOString()
                  : t.completedAt,
            };
          }
          return t;
        }),
      );
    } else {
      const newTask: Task = {
        ...taskData,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        completedAt:
          taskData.status === "DONE" ? new Date().toISOString() : undefined,
      };
      setTasks((prev) => [...prev, newTask]);
    }
    setIsTaskModalOpen(false);
    setEditingTask(null);
  };

  const openNewTaskModal = () => {
    setEditingTask(null);
    setIsTaskModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const updateTaskStatus = (id: string, status: TaskStatus) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            status,
            completedAt:
              status === "DONE" && t.status !== "DONE"
                ? new Date().toISOString()
                : t.completedAt,
          };
        }
        return t;
      }),
    );
  };

  const handleDeleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setIsTaskModalOpen(false);
  };

  // Derived state for dashboard
  const todayTasks = tasks.filter(
    (t) => t.status !== "DONE" && isToday(parseISO(t.deadline)),
  );
  const upcomingDeadlines = tasks
    .filter(
      (t) =>
        t.status !== "DONE" &&
        isAfter(parseISO(t.deadline), startOfDay(new Date())),
    )
    .sort(
      (a, b) => parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime(),
    )
    .slice(0, 5); // top 5

  if (isLoading)
    return (
      <div className="h-screen bg-background flex items-center justify-center text-primary">
        로딩 중...
      </div>
    );

  return (
    <div className="flex h-screen bg-background text-on-background overflow-hidden font-body selection:bg-primary-container selection:text-on-primary-container">
      {/* Left Navigation */}
      <nav className="w-64 flex-shrink-0 bg-surface border-r border-border flex flex-col hidden md:flex">
        <div className="p-6 pb-8 border-b border-border/50">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-headline text-xl font-bold text-primary">
                업무관리표
              </h1>
              <p className="text-xs text-on-surface-variant font-medium">
                외주구매팀
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <NavItem
            icon={<LayoutDashboard className="w-5 h-5" />}
            label="대시보드"
            isActive={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
          />
          <NavItem
            icon={<ClipboardList className="w-5 h-5" />}
            label="작업보드"
            isActive={activeTab === "tasks"}
            onClick={() => setActiveTab("tasks")}
          />
          <NavItem
            icon={<CalendarIcon className="w-5 h-5" />}
            label="캘린더"
            isActive={activeTab === "calendar"}
            onClick={() => setActiveTab("calendar")}
          />
          <NavItem
            icon={<SettingsIcon className="w-5 h-5" />}
            label="백업 및 설정"
            isActive={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
          />
        </div>

        <div className="p-4 border-t border-border/50 flex flex-col gap-4">
          <div className="flex justify-between items-center px-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant">
              <CheckCircle className="w-3.5 h-3.5 text-primary" />
              <span>오프라인 저장됨</span>
            </div>
            <button
              onClick={toggleTheme}
              className="p-1 rounded-full hover:bg-surface-variant text-on-surface-variant transition-colors"
            >
              {isDarkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
          <button
            onClick={openNewTaskModal}
            className="w-full py-3 px-4 bg-primary text-on-primary rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-sm"
          >
            <Plus className="w-5 h-5" />
            일정 추가
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="h-16 px-6 border-b border-border bg-surface flex items-center justify-between flex-shrink-0 z-10 md:hidden">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            <span className="font-headline font-bold">외주구매팀</span>
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-surface-variant text-on-surface-variant transition-colors"
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-6">
          <div className="max-w-7xl mx-auto h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === "dashboard" && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex-1 flex flex-col gap-6 h-full pb-8 pt-2"
                >
                  {/* Stats Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
                    <div className="bg-surface rounded-2xl p-5 border border-border shadow-sm flex items-center justify-between hover:border-primary/50 transition-colors">
                      <div>
                        <p className="text-sm font-bold text-on-surface-variant mb-1">
                          오늘의 일정
                        </p>
                        <h3 className="text-3xl font-headline font-bold text-primary">
                          {todayTasks.length}
                        </h3>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-primary-container text-primary flex items-center justify-center">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="bg-surface rounded-2xl p-5 border border-border shadow-sm flex items-center justify-between hover:border-tertiary/50 transition-colors">
                      <div>
                        <p className="text-sm font-bold text-on-surface-variant mb-1">
                          진행 중인 작업
                        </p>
                        <h3 className="text-3xl font-headline font-bold text-tertiary">
                          {
                            tasks.filter((t) => t.status === "IN_PROGRESS")
                              .length
                          }
                        </h3>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-tertiary-container text-tertiary flex items-center justify-center">
                        <Activity className="w-6 h-6" />
                      </div>
                    </div>
                    <div className="bg-surface rounded-2xl p-5 border border-border shadow-sm flex items-center justify-between hover:border-error/50 transition-colors">
                      <div>
                        <p className="text-sm font-bold text-on-surface-variant mb-1">
                          다가오는 마감
                        </p>
                        <h3 className="text-3xl font-headline font-bold text-error">
                          {upcomingDeadlines.length}
                        </h3>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-error-container text-error flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                    {/* Main Schedule List */}
                    <div className="lg:col-span-2 bg-surface rounded-2xl p-6 border border-border shadow-sm flex flex-col overflow-hidden">
                      <h3 className="font-headline text-xl font-bold mb-6 flex items-center gap-2 text-on-surface">
                        <CalendarIcon className="w-6 h-6 text-primary" />
                        전체 일정 타임라인
                      </h3>

                      {tasks.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-on-surface-variant opacity-60">
                          <ClipboardList className="w-12 h-12 mb-4 opacity-50" />
                          <p>등록된 일정이 없습니다.</p>
                          <button
                            onClick={openNewTaskModal}
                            className="mt-4 text-primary font-bold hover:underline"
                          >
                            첫 번째 일정 추가하기
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3 overflow-y-auto pr-2 flex-1 hide-scrollbar">
                          {tasks
                            .slice()
                            .sort(
                              (a, b) =>
                                parseISO(a.deadline).getTime() -
                                parseISO(b.deadline).getTime(),
                            )
                            .map((task) => (
                              <div
                                key={task.id}
                                onClick={() => openEditTaskModal(task)}
                                className="flex items-start gap-4 p-4 rounded-xl border border-border hover:bg-surface-variant transition-colors cursor-pointer group"
                              >
                                <div className="mt-1">
                                  {task.status === "DONE" ? (
                                    <CheckCircle className="w-5 h-5 text-primary opacity-60" />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full border-2 border-border group-hover:border-primary transition-colors" />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <TaskBadge type={task.type} />
                                      <h4
                                        className={`font-bold ${task.status === "DONE" ? "line-through text-on-surface-variant opacity-60" : ""}`}
                                      >
                                        {task.title}
                                      </h4>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-on-surface-variant mt-2">
                                    <span className="flex items-center gap-1 font-medium bg-background px-2 py-1 rounded-md border border-border">
                                      <Clock className="w-3.5 h-3.5" />
                                      {format(
                                        parseISO(task.deadline),
                                        "yyyy년 MM월 dd일 HH:mm",
                                        { locale: ko },
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Today & Upcoming */}
                    <div className="flex flex-col gap-6 overflow-hidden">
                      {/* Today's Tasks */}
                      <div className="bg-surface rounded-2xl p-6 border border-border shadow-sm flex-1 flex flex-col overflow-hidden">
                        <h3 className="font-headline text-lg font-bold mb-4 flex items-center gap-2 text-primary">
                          <CheckCircle className="w-5 h-5" />
                          오늘의 할 일
                        </h3>
                        {todayTasks.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-sm text-on-surface-variant font-medium border-2 border-dashed border-border rounded-xl">
                            오늘 예정된 일정이 없습니다.
                          </div>
                        ) : (
                          <div className="space-y-3 overflow-y-auto pr-1 hide-scrollbar">
                            {todayTasks.map((task) => (
                              <div
                                key={task.id}
                                onClick={() => openEditTaskModal(task)}
                                className="p-3 bg-surface-variant hover:bg-border cursor-pointer transition-colors rounded-xl text-sm border border-border/50"
                              >
                                <div className="font-bold mb-1 truncate">
                                  {task.title}
                                </div>
                                <div className="text-on-surface-variant flex items-center gap-1 font-medium">
                                  <Clock className="w-3.5 h-3.5" />
                                  {format(parseISO(task.deadline), "a h:mm", {
                                    locale: ko,
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Upcoming Deadlines */}
                      <div className="bg-surface rounded-2xl p-6 border border-border shadow-sm flex-1 flex flex-col overflow-hidden">
                        <h3 className="font-headline text-lg font-bold mb-4 flex items-center gap-2 text-tertiary">
                          <AlertTriangle className="w-5 h-5" />
                          다가오는 마감일
                        </h3>
                        {upcomingDeadlines.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-sm text-on-surface-variant font-medium border-2 border-dashed border-border rounded-xl">
                            다가오는 마감이 없습니다.
                          </div>
                        ) : (
                          <div className="space-y-3 overflow-y-auto pr-1 hide-scrollbar">
                            {upcomingDeadlines.map((task) => {
                              const date = parseISO(task.deadline);
                              const isTom = isTomorrow(date);
                              return (
                                <div
                                  key={task.id}
                                  onClick={() => openEditTaskModal(task)}
                                  className="p-3 border-l-4 border-tertiary bg-tertiary-container/10 hover:bg-tertiary-container/20 cursor-pointer transition-colors rounded-r-xl rounded-l-sm border-y border-r border-border/50"
                                >
                                  <div className="font-bold text-sm mb-1 truncate">
                                    {task.title}
                                  </div>
                                  <div className="text-xs text-on-surface-variant flex items-center justify-between font-medium mt-1">
                                    <span>
                                      {format(date, "MMM do (E)", {
                                        locale: ko,
                                      })}
                                    </span>
                                    <span className="font-bold text-tertiary px-2 py-0.5 bg-tertiary-container/30 rounded-full">
                                      {isTom ? "내일" : format(date, "MM/dd")}
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
                  transition={{ duration: 0.2 }}
                  className="h-full flex flex-col"
                >
                  <div className="mb-6 flex justify-between items-end">
                    <div>
                      <h2 className="font-headline text-3xl font-bold mb-1">
                        작업보드
                      </h2>
                      <p className="text-on-surface-variant">
                        모든 작업을 상태별로 관리하세요.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
                    <TaskColumn
                      title="해야 할 일"
                      tasks={tasks.filter((t) => t.status === "TODO")}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
                      status="TODO"
                      accent="bg-border"
                    />
                    <TaskColumn
                      title="진행 중"
                      tasks={tasks.filter((t) => t.status === "IN_PROGRESS")}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
                      status="IN_PROGRESS"
                      accent="bg-tertiary"
                    />
                    <TaskColumn
                      title="완료"
                      tasks={tasks
                        .filter((t) => t.status === "DONE")
                        .sort(
                          (a, b) =>
                            parseISO(a.deadline).getTime() -
                            parseISO(b.deadline).getTime(),
                        )}
                      onUpdateStatus={updateTaskStatus}
                      onEditTask={openEditTaskModal}
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
                  transition={{ duration: 0.2 }}
                  className="h-full flex flex-col pb-6"
                >
                  <div className="mb-6 flex-shrink-0">
                    <h2 className="font-headline text-3xl font-bold mb-1">
                      캘린더
                    </h2>
                    <p className="text-on-surface-variant">
                      월별 전체 일정을 확인하세요.
                    </p>
                  </div>
                  <div className="flex-1 overflow-hidden bg-surface rounded-2xl border border-border shadow-sm flex flex-col p-4 md:p-6">
                    <FullCalendar
                      tasks={tasks}
                      onEditTask={openEditTaskModal}
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === "settings" && (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="max-w-3xl pb-20"
                >
                  <h2 className="font-headline text-3xl font-bold mb-2">
                    설정 및 백업
                  </h2>
                  <p className="text-on-surface-variant mb-8">
                    앱 환경 설정과 데이터를 관리하세요.
                  </p>

                  <div className="space-y-6">
                    {/* Notification Settings */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-border shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-tertiary-container text-tertiary rounded-xl flex items-center justify-center">
                            <Bell className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-headline text-xl font-bold">
                              사용자 맞춤형 알림
                            </h3>
                            <p className="text-sm text-on-surface-variant">
                              일정 마감 및 미팅 시작 전 알림을 받습니다.
                            </p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            defaultChecked
                          />
                          <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                      </div>

                      <div className="space-y-3 mt-6 border-t border-border pt-6">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-medium text-on-surface">
                            미팅 알림 시점
                          </span>
                          <select className="bg-surface-variant border-none rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary">
                            <option>1시간 전</option>
                            <option>30분 전</option>
                            <option>1일 전</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-medium text-on-surface">
                            입찰/제출 마감 알림
                          </span>
                          <select className="bg-surface-variant border-none rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary">
                            <option>1일 전</option>
                            <option>3일 전</option>
                            <option>당일 오전 9시</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Backup Section */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-border shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-primary-container text-primary rounded-xl flex items-center justify-center">
                          <Download className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-headline text-xl font-bold">
                            오프라인 데이터 내보내기
                          </h3>
                          <p className="text-sm text-on-surface-variant">
                            모든 일정을 메모장(.txt) 파일로 저장합니다.
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleExportData}
                        className="mt-4 px-6 py-3 bg-surface-variant hover:bg-border text-on-surface font-bold rounded-xl flex items-center gap-2 transition-colors w-full md:w-auto"
                      >
                        <Download className="w-5 h-5" />
                        데이터 백업 다운로드
                      </button>
                      <p className="text-xs text-on-surface-variant mt-3">
                        * 저장할 때마다 날짜가 포함된 새로운 파일이 생성됩니다.
                      </p>
                    </div>

                    {/* Restore Section */}
                    <div className="bg-surface rounded-2xl p-6 md:p-8 border border-border shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-surface-variant text-on-surface rounded-xl flex items-center justify-center">
                          <Upload className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-headline text-xl font-bold">
                            백업 파일 불러오기
                          </h3>
                          <p className="text-sm text-on-surface-variant">
                            이전에 저장한 .txt 백업 파일을 불러옵니다.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 relative overflow-hidden">
                        <input
                          type="file"
                          accept=".txt,.json"
                          onChange={handleImportData}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <button className="px-6 py-3 border-2 border-dashed border-border hover:border-primary text-on-surface font-bold rounded-xl flex items-center justify-center gap-2 transition-colors w-full">
                          <Upload className="w-5 h-5" />
                          백업 파일 선택
                        </button>
                      </div>
                      <p className="text-xs text-error mt-3">
                        * 주의: 파일을 불러오면 현재 브라우저에 있는 데이터가
                        모두 덮어쓰기 됩니다.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-between px-6 py-2 z-50">
        <MobileNavItem
          icon={<LayoutDashboard />}
          isActive={activeTab === "dashboard"}
          onClick={() => setActiveTab("dashboard")}
        />
        <MobileNavItem
          icon={<ClipboardList />}
          isActive={activeTab === "tasks"}
          onClick={() => setActiveTab("tasks")}
        />
        <button
          onClick={openNewTaskModal}
          className="w-12 h-12 flex-shrink-0 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg transform -translate-y-4"
        >
          <Plus className="w-6 h-6" />
        </button>
        <MobileNavItem
          icon={<CalendarIcon />}
          isActive={activeTab === "calendar"}
          onClick={() => setActiveTab("calendar")}
        />
        <MobileNavItem
          icon={<SettingsIcon />}
          isActive={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        />
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
              className="relative bg-surface w-full max-w-lg rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="flex justify-between items-center p-6 border-b border-border">
                <h2 className="font-headline text-xl font-bold">
                  {editingTask ? "일정 수정" : "새 일정 등록"}
                </h2>
                <button
                  onClick={() => setIsTaskModalOpen(false)}
                  className="p-2 hover:bg-surface-variant rounded-full text-on-surface-variant"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <TaskForm
                initialData={editingTask}
                onSubmit={handleSaveTask}
                onCancel={() => setIsTaskModalOpen(false)}
                onDelete={
                  editingTask
                    ? () => handleDeleteTask(editingTask.id)
                    : undefined
                }
              />
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
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-medium ${
        isActive
          ? "bg-primary-container text-on-primary-container font-bold"
          : "text-on-surface-variant hover:bg-surface-variant"
      }`}
    >
      {icon}
      {label}
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
        isActive
          ? "text-primary bg-primary-container/50"
          : "text-on-surface-variant"
      }`}
    >
      {icon}
    </button>
  );
}

function TaskBadge({ type }: { type: TaskType }) {
  const config = {
    MEETING: {
      label: "미팅",
      classes: "bg-primary-container text-primary font-bold",
    },
    BID: { label: "입찰", classes: "bg-error-container text-error font-bold" },
    SUBMISSION: {
      label: "제출",
      classes: "bg-tertiary-container text-tertiary font-bold",
    },
    GENERAL: {
      label: "일반",
      classes: "bg-surface-variant text-on-surface-variant",
    },
  };
  const { label, classes } = config[type];

  return (
    <span
      className={`px-2 py-0.5 rounded-md text-[11px] uppercase tracking-wider ${classes}`}
    >
      {label}
    </span>
  );
}

function TaskColumn({
  title,
  tasks,
  onUpdateStatus,
  onEditTask,
  status,
  accent,
}: {
  title: string;
  tasks: Task[];
  onUpdateStatus: (id: string, s: TaskStatus) => void;
  onEditTask: (t: Task) => void;
  status: TaskStatus;
  accent: string;
}) {
  return (
    <div className="flex flex-col bg-surface-variant/30 rounded-2xl p-4 h-full overflow-hidden border border-border/50">
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
            <h4
              className={`font-bold text-base mb-2 ${task.status === "DONE" ? "line-through text-on-surface-variant opacity-70" : ""}`}
            >
              {task.title}
            </h4>
            {task.description && (
              <p className="text-sm text-on-surface-variant line-clamp-2 mb-3">
                {task.description}
              </p>
            )}

            <div
              className="flex items-center justify-between mt-4 pt-3 border-t border-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs text-on-surface-variant flex items-center gap-1">
                <CalendarIcon className="w-3.5 h-3.5" />
                {format(parseISO(task.deadline), "MM/dd HH:mm")}
              </div>

              {/* Quick Status Toggles */}
              <div className="flex items-center gap-1">
                {status !== "TODO" && (
                  <button
                    onClick={() => onUpdateStatus(task.id, "TODO")}
                    className="p-1 hover:bg-surface-variant rounded text-on-surface-variant"
                    title="해야 할 일로 이동"
                  >
                    <RefreshCcw className="w-4 h-4" />
                  </button>
                )}
                {status !== "IN_PROGRESS" && (
                  <button
                    onClick={() => onUpdateStatus(task.id, "IN_PROGRESS")}
                    className="p-1 hover:bg-surface-variant rounded text-tertiary"
                    title="진행 중으로 이동"
                  >
                    <Clock className="w-4 h-4" />
                  </button>
                )}
                {status !== "DONE" && (
                  <button
                    onClick={() => onUpdateStatus(task.id, "DONE")}
                    className="p-1 hover:bg-surface-variant rounded text-primary"
                    title="완료 처리"
                  >
                    <Check className="w-4 h-4" />
                  </button>
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
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
];

function TaskForm({
  initialData,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initialData?: Task | null;
  onSubmit: (t: Omit<Task, "id" | "createdAt">) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [type, setType] = useState<TaskType>(initialData?.type || "GENERAL");

  const initDeadline = initialData?.deadline
    ? parseISO(initialData.deadline)
    : new Date();
  const [date, setDate] = useState(format(initDeadline, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(initDeadline, "HH:mm"));
  const [desc, setDesc] = useState(initialData?.description || "");
  const [color, setColor] = useState(initialData?.color || TASK_COLORS[4]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Combine date and time
    const deadline = new Date(`${date}T${time}`).toISOString();

    onSubmit({
      title,
      type,
      deadline,
      status: initialData?.status || "TODO",
      description: desc,
      color,
      completedAt: initialData?.completedAt,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
      <div>
        <label className="block text-sm font-bold mb-1.5">일정 제목</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="프로젝트 A 입찰 서류 제출..."
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          required
        />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-bold mb-1.5">유형</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none"
          >
            <option value="MEETING">미팅 (Meeting)</option>
            <option value="BID">입찰 (Bid)</option>
            <option value="SUBMISSION">업무 제출 (Submission)</option>
            <option value="GENERAL">일반 (General)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1.5">
            마감/시작 시간
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50"
              required
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50"
              required
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold mb-1.5">색상 지정</label>
        <div className="flex flex-wrap gap-2">
          {TASK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${color === c ? "scale-110 ring-2 ring-offset-2 ring-on-surface ring-offset-surface" : "hover:scale-105 opacity-80"}`}
              style={{ backgroundColor: c }}
            >
              {color === c && (
                <Check className="w-4 h-4 text-white drop-shadow-md" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold mb-1.5">
          상세 내용 (선택)
        </label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="관련 자료 링크나 참고 사항을 적어주세요."
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all min-h-[100px] resize-none"
        />
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-border">
        {onDelete &&
          (showDeleteConfirm ? (
            <div className="flex items-center gap-3 mr-auto bg-error-container/30 px-3 py-1.5 rounded-xl border border-error/50">
              <span className="text-xs font-bold text-error">
                삭제하시겠습니까?
              </span>
              <button
                type="button"
                onClick={onDelete}
                className="text-error hover:underline text-sm font-bold px-1"
              >
                네
              </button>
              <span className="text-error/30">|</span>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="text-on-surface-variant hover:underline text-sm px-1"
              >
                아니오
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="py-3 px-4 rounded-xl border border-error text-error hover:bg-error-container/20 transition-colors mr-auto"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          ))}
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 px-4 rounded-xl border border-border font-bold hover:bg-surface-variant transition-colors"
        >
          취소
        </button>
        <button
          type="submit"
          className="flex-1 py-3 px-4 rounded-xl bg-primary text-on-primary font-bold hover:opacity-90 transition-colors shadow-sm"
        >
          {initialData ? "저장하기" : "등록하기"}
        </button>
      </div>
    </form>
  );
}

function FullCalendar({
  tasks,
  onEditTask,
}: {
  tasks: Task[];
  onEditTask: (t: Task) => void;
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showSelector, setShowSelector] = useState(false);
  const [selectorMode, setSelectorMode] = useState<"month" | "year">("month");
  const [yearPageStart, setYearPageStart] = useState(() => {
    const currentYear = new Date().getFullYear();
    return 2020 + Math.floor((currentYear - 2020) / 12) * 12;
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const startDay = getDay(monthStart);
  const paddingDays = Array.from({ length: startDay }).map((_, i) => i);

  return (
    <div className="h-full flex flex-col bg-surface-variant/30 rounded-xl overflow-hidden">
      <div className="relative flex items-center justify-between mb-4 p-2">
        <button
          onClick={() => {
            setShowSelector(!showSelector);
            setSelectorMode("month");
          }}
          className="font-headline text-2xl font-bold hover:text-primary transition-colors flex items-center gap-1 p-2 rounded-lg hover:bg-surface-variant"
        >
          {format(currentDate, "yyyy년 M월", { locale: ko })}
          <ChevronDown className="w-6 h-6" />
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="p-2 hover:bg-surface-variant rounded-lg border border-border bg-surface text-on-surface-variant transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="p-2 hover:bg-surface-variant rounded-lg border border-border bg-surface text-on-surface-variant transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
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
                        setYearPageStart(
                          2020 + Math.floor((year - 2020) / 12) * 12,
                        );
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
                          setShowSelector(false);
                        }}
                        className={`py-2 rounded-lg font-medium text-sm transition-colors ${currentDate.getMonth() === i ? "bg-primary text-on-primary" : "hover:bg-surface-variant"}`}
                      >
                        {i + 1}월
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-border flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentDate(new Date());
                        setShowSelector(false);
                      }}
                      className="text-xs text-primary font-bold hover:underline py-1.5 flex items-center gap-1"
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      오늘날짜로 바로 돌아가기
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-4 px-2">
                    <button
                      onClick={() => setSelectorMode("month")}
                      className="font-bold text-lg hover:text-primary flex items-center gap-1"
                    >
                      <ChevronLeft className="w-5 h-5" />
                      연도 선택
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setYearPageStart((prev) => prev - 12)}
                        className="p-1 hover:bg-surface-variant rounded-md text-on-surface-variant transition-colors"
                        title="이전 12년"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setYearPageStart((prev) => prev + 12)}
                        className="p-1 hover:bg-surface-variant rounded-md text-on-surface-variant transition-colors"
                        title="다음 12년"
                      >
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
                            setSelectorMode("month");
                          }}
                          className={`py-2 rounded-lg font-medium text-sm transition-colors ${currentDate.getFullYear() === year ? "bg-primary text-on-primary" : "hover:bg-surface-variant"}`}
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

      <div className="grid grid-cols-7 gap-2 text-center text-sm font-bold mb-2 p-2">
        <div className="text-red-500">일</div>
        <div className="text-on-surface-variant">월</div>
        <div className="text-on-surface-variant">화</div>
        <div className="text-on-surface-variant">수</div>
        <div className="text-on-surface-variant">목</div>
        <div className="text-on-surface-variant">금</div>
        <div className="text-blue-500">토</div>
      </div>

      <div className="grid grid-cols-7 gap-2 flex-1 auto-rows-[minmax(80px,_1fr)] overflow-y-auto pr-1 pb-2 px-2">
        {paddingDays.map((i) => (
          <div key={`pad-${i}`} className="p-2 rounded-xl bg-surface/50" />
        ))}
        {daysInMonth.map((day) => {
          const isT = isToday(day);
          const dayOfWeek = getDay(day);
          const isSun = dayOfWeek === 0;
          const isSat = dayOfWeek === 6;
          const dayTasks = tasks.filter((t) =>
            isSameDay(parseISO(t.deadline), day),
          );

          return (
            <div
              key={day.toString()}
              className={`p-2 rounded-xl bg-surface border ${isT ? "border-primary shadow-sm" : "border-border"} flex flex-col min-h-[80px] overflow-hidden`}
            >
              <div
                className={`text-sm font-bold mb-1.5 flex items-center justify-between ${isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-on-surface"}`}
              >
                <span>{format(day, "d")}</span>
                {isT && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-on-primary">
                    오늘
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 hide-scrollbar">
                {dayTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditTask(t);
                    }}
                    style={{ backgroundColor: t.color || "#4a7c59" }}
                    className="text-white text-[11px] font-medium px-2 py-1 rounded truncate leading-tight shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                    title={t.title}
                  >
                    <span
                      className={
                        t.status === "DONE" ? "line-through opacity-70" : ""
                      }
                    >
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
