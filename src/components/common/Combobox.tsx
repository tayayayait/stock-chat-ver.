import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  label: string;
  value: string;
}

export type ComboboxOptionInput = string | ComboboxOption;

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  options?: ComboboxOptionInput[];
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
  disabledHelperText?: string;
  emptyMessage?: string;
  noMatchMessage?: string;
  allowManualInput?: boolean;
  searchable?: boolean;
  className?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  toggleAriaLabel?: string;
}

const DEFAULT_EMPTY_MESSAGE = '등록된 항목이 없습니다.';
const DEFAULT_NO_MATCH_MESSAGE = '일치하는 항목이 없습니다.';

const defaultInputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

const normalizeOptions = (options: ComboboxOptionInput[]): ComboboxOption[] => {
  const map = new Map<string, ComboboxOption>();
  options.forEach((option) => {
    const normalized =
      typeof option === 'string'
        ? { label: option.trim(), value: option.trim() }
        : { label: option.label.trim(), value: option.value.trim() };
    if (!normalized.value) {
      return;
    }
    if (!normalized.label) {
      normalized.label = normalized.value;
    }
    map.set(normalized.value, normalized);
  });
  return Array.from(map.values());
};

const Combobox: React.FC<ComboboxProps> = ({
  id,
  value,
  onChange,
  onSelect,
  options = [],
  disabled = false,
  placeholder = '',
  helperText,
  disabledHelperText,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  noMatchMessage = DEFAULT_NO_MATCH_MESSAGE,
  allowManualInput = true,
  searchable = true,
  className,
  inputClassName = defaultInputClass,
  dropdownClassName =
    'absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl',
  toggleAriaLabel = '목록 토글',
}) => {
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const listboxId = id ? `${id}-listbox` : `${generatedId}-listbox`;

  const normalizedFilter = useMemo(() => filter.trim().toLowerCase(), [filter]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !normalizedFilter) {
      return normalizedOptions;
    }
    return normalizedOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(normalizedFilter) ||
        option.value.toLowerCase().includes(normalizedFilter),
    );
  }, [normalizedOptions, normalizedFilter, searchable]);

  useEffect(() => {
    const match = normalizedOptions.find((option) => option.value === value.trim());
    if (match) {
      setFilter(match.label);
      return;
    }
    if (allowManualInput) {
      setFilter(value);
      return;
    }
    setFilter('');
  }, [allowManualInput, normalizedOptions, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (filteredOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    const matchedIndex = filteredOptions.findIndex(
      (option) => option.value === value.trim(),
    );
    setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0);
  }, [filteredOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!listRef.current || activeIndex < 0) {
      return;
    }
    const activeNode = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeNode?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const setSelectedValue = useCallback(
    (option: ComboboxOption) => {
      setFilter(option.label);
      onChange(option.value);
      onSelect?.(option.value);
      setIsOpen(false);
    },
    [onChange, onSelect],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!allowManualInput) {
        return;
      }
      const next = event.target.value;
      setFilter(next);
      onChange(next);
      if (!isOpen) {
        setIsOpen(true);
      }
    },
    [allowManualInput, isOpen, onChange],
  );

  const handleInputFocus = useCallback(() => {
    if (disabled) {
      return;
    }
    setIsOpen(true);
  }, [disabled]);

  const handleToggle = useCallback(() => {
    if (disabled) {
      return;
    }
    setIsOpen((previous) => !previous);
  }, [disabled]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((previous) => {
          if (filteredOptions.length === 0) {
            return -1;
          }
          const next = previous + 1 < filteredOptions.length ? previous + 1 : 0;
          return next < 0 ? 0 : next;
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((previous) => {
          if (filteredOptions.length === 0) {
            return -1;
          }
          const next = previous - 1 >= 0 ? previous - 1 : filteredOptions.length - 1;
          return next;
        });
        return;
      }
      if (event.key === 'Enter') {
        if (isOpen && activeIndex >= 0 && activeIndex < filteredOptions.length) {
          event.preventDefault();
          setSelectedValue(filteredOptions[activeIndex]);
        }
        return;
      }
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    },
    [activeIndex, disabled, filteredOptions, isOpen, setSelectedValue],
  );

  const displayHelperText = disabled ? disabledHelperText : helperText;
  const displayValue = allowManualInput ? filter : normalizedOptions.find((option) => option.value === value.trim())?.label ?? '';

  return (
    <div className={className}>
      <div className="relative" ref={containerRef}>
        <input
          id={id}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={!allowManualInput}
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          role="combobox"
          className={`${inputClassName} pr-10 ${disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''}`}
        />
        <button
          type="button"
          aria-label={toggleAriaLabel}
          className="absolute inset-y-0 right-2 flex items-center rounded-full p-1 text-slate-400 transition hover:text-slate-600 disabled:cursor-not-allowed disabled:text-slate-300"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleToggle}
          disabled={disabled}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          >
            <path
              d="M5 7l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {isOpen && (
          <div id={listboxId} role="listbox" className={dropdownClassName} ref={listRef}>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400">
                {normalizedOptions.length === 0 ? emptyMessage : noMatchMessage}
              </div>
            ) : (
              filteredOptions.map((option, index) => {
                const isActive = index === activeIndex;
                const isSelected = value.trim().toLowerCase() === option.value.toLowerCase();
                return (
                  <button
                    key={`${option.value}-${option.label}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setSelectedValue(option)}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                      isActive ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{option.label}</span>
                    {isSelected ? (
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-indigo-600"
                      >
                        <path
                          d="M5 10l3 3 7-7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      {displayHelperText ? (
        <p className="mt-1 text-xs text-slate-400">{displayHelperText}</p>
      ) : null}
    </div>
  );
};

export default Combobox;
