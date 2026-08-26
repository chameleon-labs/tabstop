import {useNavigation} from 'react-router';
import './route-progress.css';

export type RouteProgressProps = {
  busy: boolean;
};

export const RouteProgress = ({busy}: RouteProgressProps): React.JSX.Element | null => {
  const {state} = useNavigation();

  if (state === 'idle') {
    return null;
  }

  return (
    <>
      {busy && (
        <div className="route-progress" aria-hidden="true">
          <span className="route-progress__sweep" />
        </div>
      )}
      <p role="status" aria-live="polite" className="visually-hidden">
        {busy ? 'Loading…' : ''}
      </p>
    </>
  );
};
