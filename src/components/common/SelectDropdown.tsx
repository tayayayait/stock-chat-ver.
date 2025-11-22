import React from 'react';

import Combobox, { ComboboxOption, ComboboxProps } from './Combobox';

export interface SelectDropdownProps
  extends Omit<ComboboxProps, 'options' | 'value' | 'onChange' | 'allowManualInput' | 'searchable'> {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
}

const SelectDropdown: React.FC<SelectDropdownProps> = ({
  options,
  value,
  onChange,
  ...rest
}) => (
  <Combobox
    {...rest}
    options={options}
    value={value}
    onChange={onChange}
    allowManualInput={false}
    searchable={false}
  />
);

export default SelectDropdown;
