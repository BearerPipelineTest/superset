/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React, {
  forwardRef,
  ReactElement,
  ReactNode,
  RefObject,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import { ensureIsArray, styled, t } from '@superset-ui/core';
import AntdSelect, {
  SelectProps as AntdSelectProps,
  SelectValue as AntdSelectValue,
  LabeledValue as AntdLabeledValue,
} from 'antd/lib/select';
import { DownOutlined, SearchOutlined } from '@ant-design/icons';
import { Spin } from 'antd';
import { isEqual } from 'lodash';
import Icons from 'src/components/Icons';
import { rankedSearchCompare } from 'src/utils/rankedSearchCompare';
import { getValue, hasOption, isLabeledValue } from './utils';

const { Option } = AntdSelect;

type AntdSelectAllProps = AntdSelectProps<AntdSelectValue>;

type PickedSelectProps = Pick<
  AntdSelectAllProps,
  | 'allowClear'
  | 'autoFocus'
  | 'disabled'
  | 'filterOption'
  | 'labelInValue'
  | 'loading'
  | 'notFoundContent'
  | 'onChange'
  | 'onClear'
  | 'onFocus'
  | 'onBlur'
  | 'onDropdownVisibleChange'
  | 'placeholder'
  | 'showSearch'
  | 'tokenSeparators'
  | 'value'
  | 'getPopupContainer'
>;

export type OptionsType = Exclude<AntdSelectAllProps['options'], undefined>;

export interface SelectProps extends PickedSelectProps {
  /**
   * It enables the user to create new options.
   * Can be used with standard or async select types.
   * Can be used with any mode, single or multiple.
   * False by default.
   * */
  allowNewOptions?: boolean;
  /**
   * It adds the aria-label tag for accessibility standards.
   * Must be plain English and localized.
   */
  ariaLabel: string;
  /**
   * It adds a header on top of the Select.
   * Can be any ReactNode.
   */
  header?: ReactNode;
  /**
   * It adds a helper text on top of the Select options
   * with additional context to help with the interaction.
   */
  helperText?: string;
  /**
   * It defines whether the Select should allow for the
   * selection of multiple options or single.
   * Single by default.
   */
  mode?: 'single' | 'multiple';
  /**
   * Deprecated.
   * Prefer ariaLabel instead.
   */
  name?: string; // discourage usage
  /**
   * It allows to define which properties of the option object
   * should be looked for when searching.
   * By default label and value.
   */
  optionFilterProps?: string[];
  /**
   * It defines the options of the Select.
   * The options can be static, an array of options.
   * The options can also be async, a promise that returns
   * an array of options.
   */
  options: OptionsType;
  /**
   * It shows a stop-outlined icon at the far right of a selected
   * option instead of the default checkmark.
   * Useful to better indicate to the user that by clicking on a selected
   * option it will be de-selected.
   * False by default.
   */
  invertSelection?: boolean;
  /**
   * Customize how filtered options are sorted while users search.
   * Will not apply to predefined `options` array when users are not searching.
   */
  sortComparator?: typeof DEFAULT_SORT_COMPARATOR;
}

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const StyledSelect = styled(AntdSelect)`
  ${({ theme }) => `
    && .ant-select-selector {
      border-radius: ${theme.gridUnit}px;
    }
    // Open the dropdown when clicking on the suffix
    // This is fixed in version 4.16
    .ant-select-arrow .anticon:not(.ant-select-suffix) {
      pointer-events: none;
    }
    .ant-select-dropdown {
      padding: 0;
    }
  `}
`;

const StyledStopOutlined = styled(Icons.StopOutlined)`
  vertical-align: 0;
`;

const StyledCheckOutlined = styled(Icons.CheckOutlined)`
  vertical-align: 0;
`;

const StyledSpin = styled(Spin)`
  margin-top: ${({ theme }) => -theme.gridUnit}px;
`;

const StyledLoadingText = styled.div`
  ${({ theme }) => `
    margin-left: ${theme.gridUnit * 3}px;
    line-height: ${theme.gridUnit * 8}px;
    color: ${theme.colors.grayscale.light1};
  `}
`;

const StyledHelperText = styled.div`
  ${({ theme }) => `
    padding: ${theme.gridUnit * 2}px ${theme.gridUnit * 3}px;
    color: ${theme.colors.grayscale.base};
    font-size: ${theme.typography.sizes.s}px;
    cursor: default;
    border-bottom: 1px solid ${theme.colors.grayscale.light2};
  `}
`;

const MAX_TAG_COUNT = 4;
const TOKEN_SEPARATORS = [',', '\n', '\t', ';'];
const EMPTY_OPTIONS: OptionsType = [];

export const DEFAULT_SORT_COMPARATOR = (
  a: AntdLabeledValue,
  b: AntdLabeledValue,
  search?: string,
) => {
  let aText: string | undefined;
  let bText: string | undefined;
  if (typeof a.label === 'string' && typeof b.label === 'string') {
    aText = a.label;
    bText = b.label;
  } else if (typeof a.value === 'string' && typeof b.value === 'string') {
    aText = a.value;
    bText = b.value;
  }
  // sort selected options first
  if (typeof aText === 'string' && typeof bText === 'string') {
    if (search) {
      return rankedSearchCompare(aText, bText, search);
    }
    return aText.localeCompare(bText);
  }
  return (a.value as number) - (b.value as number);
};

/**
 * It creates a comparator to check for a specific property.
 * Can be used with string and number property values.
 * */
export const propertyComparator =
  (property: string) => (a: AntdLabeledValue, b: AntdLabeledValue) => {
    if (typeof a[property] === 'string' && typeof b[property] === 'string') {
      return a[property].localeCompare(b[property]);
    }
    return (a[property] as number) - (b[property] as number);
  };

/**
 * This component is a customized version of the Antdesign 4.X Select component
 * https://ant.design/components/select/.
 * The aim of the component was to combine all the instances of select components throughout the
 * project under one and to remove the react-select component entirely.
 * This Select component provides an API that is tested against all the different use cases of Superset.
 * It limits and overrides the existing Antdesign API in order to keep their usage to the minimum
 * and to enforce simplification and standardization.
 * It is divided into two macro categories, Static and Async.
 * The Static type accepts a static array of options.
 * The Async type accepts a promise that will return the options.
 * Each of the categories come with different abilities. For a comprehensive guide please refer to
 * the storybook in src/components/Select/Select.stories.tsx.
 */
const Select = forwardRef(
  (
    {
      allowClear,
      allowNewOptions = false,
      ariaLabel,
      filterOption = true,
      header = null,
      helperText,
      invertSelection = false,
      labelInValue = false,
      loading,
      mode = 'single',
      name,
      notFoundContent,
      onChange,
      onClear,
      onDropdownVisibleChange,
      optionFilterProps = ['label', 'value'],
      options,
      placeholder = t('Select ...'),
      showSearch = true,
      sortComparator = DEFAULT_SORT_COMPARATOR,
      tokenSeparators,
      value,
      getPopupContainer,
      ...props
    }: SelectProps,
    ref: RefObject<HTMLInputElement>,
  ) => {
    const isSingleMode = mode === 'single';
    const shouldShowSearch = allowNewOptions ? true : showSearch;
    const [selectValue, setSelectValue] = useState(value);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(loading);
    const [isDropdownVisible, setIsDropdownVisible] = useState(false);
    const mappedMode = isSingleMode
      ? undefined
      : allowNewOptions
      ? 'tags'
      : 'multiple';

    const sortSelectedFirst = useCallback(
      (a: AntdLabeledValue, b: AntdLabeledValue) =>
        selectValue && a.value !== undefined && b.value !== undefined
          ? Number(hasOption(b.value, selectValue)) -
            Number(hasOption(a.value, selectValue))
          : 0,
      [selectValue],
    );
    const sortComparatorWithSearch = useCallback(
      (a: AntdLabeledValue, b: AntdLabeledValue) =>
        sortSelectedFirst(a, b) || sortComparator(a, b, inputValue),
      [inputValue, sortComparator, sortSelectedFirst],
    );

    const initialOptions = useMemo(
      () =>
        options && Array.isArray(options) ? options.slice() : EMPTY_OPTIONS,
      [options],
    );
    const initialOptionsSorted = useMemo(
      () => initialOptions.slice().sort(sortSelectedFirst),
      [initialOptions, sortSelectedFirst],
    );

    const [selectOptions, setSelectOptions] =
      useState<OptionsType>(initialOptionsSorted);

    // add selected values to options list if they are not in it
    const fullSelectOptions = useMemo(() => {
      const missingValues: OptionsType = ensureIsArray(selectValue)
        .filter(opt => !hasOption(getValue(opt), selectOptions))
        .map(opt =>
          isLabeledValue(opt) ? opt : { value: opt, label: String(opt) },
        );
      return missingValues.length > 0
        ? missingValues.concat(selectOptions)
        : selectOptions;
    }, [selectOptions, selectValue]);

    const hasCustomLabels = fullSelectOptions.some(opt => !!opt?.customLabel);

    const handleOnSelect = (
      selectedItem: string | number | AntdLabeledValue | undefined,
    ) => {
      if (isSingleMode) {
        setSelectValue(selectedItem);
      } else {
        setSelectValue(previousState => {
          const array = ensureIsArray(previousState);
          const value = getValue(selectedItem);
          // Tokenized values can contain duplicated values
          if (!hasOption(value, array)) {
            const result = [...array, selectedItem];
            return isLabeledValue(selectedItem)
              ? (result as AntdLabeledValue[])
              : (result as (string | number)[]);
          }
          return previousState;
        });
      }
      setInputValue('');
    };

    const handleOnDeselect = (
      value: string | number | AntdLabeledValue | undefined,
    ) => {
      if (Array.isArray(selectValue)) {
        if (isLabeledValue(value)) {
          const array = selectValue as AntdLabeledValue[];
          setSelectValue(
            array.filter(element => element.value !== value.value),
          );
        } else {
          const array = selectValue as (string | number)[];
          setSelectValue(array.filter(element => element !== value));
        }
      }
      setInputValue('');
    };

    const handleOnSearch = (search: string) => {
      const searchValue = search.trim();
      if (allowNewOptions && isSingleMode) {
        const newOption = searchValue &&
          !hasOption(searchValue, fullSelectOptions, true) && {
            label: searchValue,
            value: searchValue,
            isNewOption: true,
          };
        const cleanSelectOptions = fullSelectOptions.filter(
          opt => !opt.isNewOption || hasOption(opt.value, selectValue),
        );
        const newOptions = newOption
          ? [newOption, ...cleanSelectOptions]
          : cleanSelectOptions;
        setSelectOptions(newOptions);
      }
      setInputValue(search);
    };

    const handleFilterOption = (search: string, option: AntdLabeledValue) => {
      if (typeof filterOption === 'function') {
        return filterOption(search, option);
      }

      if (filterOption) {
        const searchValue = search.trim().toLowerCase();
        if (optionFilterProps && optionFilterProps.length) {
          return optionFilterProps.some(prop => {
            const optionProp = option?.[prop]
              ? String(option[prop]).trim().toLowerCase()
              : '';
            return optionProp.includes(searchValue);
          });
        }
      }

      return false;
    };

    const handleOnDropdownVisibleChange = (isDropdownVisible: boolean) => {
      setIsDropdownVisible(isDropdownVisible);

      // if no search input value, force sort options because it won't be sorted by
      // `filterSort`.
      if (isDropdownVisible && !inputValue && selectOptions.length > 1) {
        if (!isEqual(initialOptionsSorted, selectOptions)) {
          setSelectOptions(initialOptionsSorted);
        }
      }
      if (onDropdownVisibleChange) {
        onDropdownVisibleChange(isDropdownVisible);
      }
    };

    const dropdownRender = (
      originNode: ReactElement & { ref?: RefObject<HTMLElement> },
    ) => {
      if (!isDropdownVisible) {
        originNode.ref?.current?.scrollTo({ top: 0 });
      }
      if (isLoading && fullSelectOptions.length === 0) {
        return <StyledLoadingText>{t('Loading...')}</StyledLoadingText>;
      }
      return (
        <>
          {helperText && (
            <StyledHelperText role="note">{helperText}</StyledHelperText>
          )}
          {originNode}
        </>
      );
    };

    // use a function instead of component since every rerender of the
    // Select component will create a new component
    const getSuffixIcon = () => {
      if (isLoading) {
        return <StyledSpin size="small" />;
      }
      if (shouldShowSearch && isDropdownVisible) {
        return <SearchOutlined />;
      }
      return <DownOutlined />;
    };

    const handleClear = () => {
      setSelectValue(undefined);
      if (onClear) {
        onClear();
      }
    };

    useEffect(() => {
      // when `options` list is updated from component prop, reset states
      setSelectOptions(initialOptions);
    }, [initialOptions]);

    useEffect(() => {
      setSelectValue(value);
    }, [value]);

    useEffect(() => {
      if (loading !== undefined && loading !== isLoading) {
        setIsLoading(loading);
      }
    }, [isLoading, loading]);

    return (
      <StyledContainer>
        {header}
        <StyledSelect
          allowClear={!isLoading && allowClear}
          aria-label={ariaLabel || name}
          dropdownRender={dropdownRender}
          filterOption={handleFilterOption}
          filterSort={sortComparatorWithSearch}
          getPopupContainer={
            getPopupContainer || (triggerNode => triggerNode.parentNode)
          }
          labelInValue={labelInValue}
          maxTagCount={MAX_TAG_COUNT}
          mode={mappedMode}
          notFoundContent={isLoading ? t('Loading...') : notFoundContent}
          onDeselect={handleOnDeselect}
          onDropdownVisibleChange={handleOnDropdownVisibleChange}
          onPopupScroll={undefined}
          onSearch={shouldShowSearch ? handleOnSearch : undefined}
          onSelect={handleOnSelect}
          onClear={handleClear}
          onChange={onChange}
          options={hasCustomLabels ? undefined : fullSelectOptions}
          placeholder={placeholder}
          showSearch={shouldShowSearch}
          showArrow
          tokenSeparators={tokenSeparators || TOKEN_SEPARATORS}
          value={selectValue}
          suffixIcon={getSuffixIcon()}
          menuItemSelectedIcon={
            invertSelection ? (
              <StyledStopOutlined iconSize="m" />
            ) : (
              <StyledCheckOutlined iconSize="m" />
            )
          }
          ref={ref}
          {...props}
        >
          {hasCustomLabels &&
            fullSelectOptions.map(opt => {
              const isOptObject = typeof opt === 'object';
              const label = isOptObject ? opt?.label || opt.value : opt;
              const value = isOptObject ? opt.value : opt;
              const { customLabel, ...optProps } = opt;
              return (
                <Option {...optProps} key={value} label={label} value={value}>
                  {isOptObject && customLabel ? customLabel : label}
                </Option>
              );
            })}
        </StyledSelect>
      </StyledContainer>
    );
  },
);

export default Select;
