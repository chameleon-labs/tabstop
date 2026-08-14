import type {Impact} from '@tabstop/contract';
import {Badge, type BadgeVariant} from '@chameleon-labs/lattice-react';
import type {ReactNode} from 'react';
import {AlertCircle, AlertTriangle, Info, type IconProps} from '@/screens/components/Icons';

const IMPACT_ICON: Record<Impact, (props: IconProps) => ReactNode> = {
  critical: AlertCircle,
  serious: AlertTriangle,
  moderate: AlertTriangle,
  minor: Info,
};

export type ImpactBadgeProps = {
  impact: Impact | null;
  count?: number | undefined;
};

export const ImpactBadge = ({impact, count}: ImpactBadgeProps): React.JSX.Element => {
  const Icon = impact === null ? Info : IMPACT_ICON[impact];
  const label = impact ?? 'unrated';

  return (
    <Badge variant={(impact ?? 'default') as BadgeVariant}>
      <Icon size="sm" />
      {count === undefined ? label : `${count} ${label}`}
    </Badge>
  );
};
