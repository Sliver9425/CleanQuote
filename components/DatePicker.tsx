"use client";

import * as React from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { DayPicker, type Matcher } from "react-day-picker";
import "react-day-picker/style.css";

type Accent = "emerald" | "orange";

interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  placeholder?: string;
  accent?: Accent;
  disabled?: Matcher | Matcher[]; // ← NUEVO v2: permite bloquear fechas
}

const ACCENT_CLASSES: Record<Accent, { ring: string; border: string }> = {
  emerald: {
    ring: "focus:ring-emerald-500",
    border: "focus:border-emerald-600",
  },
  orange: {
    ring: "focus:ring-[#C25E17]",
    border: "focus:border-[#C25E17]",
  },
};

export function DatePicker({
  date,
  setDate,
  placeholder = "Seleccionar fecha",
  accent = "emerald",
  disabled,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const cls = ACCENT_CLASSES[accent];

  // react-day-picker v9: ya no existe "fromDate". Las fechas pasadas se bloquean con "disabled",
  // sumándolo al bloqueo que pueda llegar desde afuera (por ejemplo, el fin no puede ser antes del inicio).
  const disabledMatchers: Matcher[] = [
    { before: new Date() },
    ...(Array.isArray(disabled) ? disabled : disabled ? [disabled] : []),
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full items-center justify-start rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-700 shadow-sm hover:bg-stone-50 focus:outline-none focus:ring-2 transition ${cls.ring} ${cls.border}`}
      >
        <CalendarIcon className="mr-2 h-4 w-4 text-stone-400" />
        {date ? format(date, "PPP", { locale: es }) : <span className="text-stone-400">{placeholder}</span>}
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
          <DayPicker
            mode="single"
            selected={date}
            onSelect={(selectedDate) => {
              setDate(selectedDate);
              setIsOpen(false);
            }}
            locale={es}
            startMonth={new Date()}
            disabled={disabledMatchers}
          />
        </div>
      )}
    </div>
  );
}