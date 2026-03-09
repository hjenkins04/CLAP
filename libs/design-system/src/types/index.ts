import type { ReactNode } from 'react';

export interface BaseComponentProps {
  className?: string;
  children?: ReactNode;
}

export interface DisableableProps {
  disabled?: boolean;
}

export interface LoadingProps {
  loading?: boolean;
}
