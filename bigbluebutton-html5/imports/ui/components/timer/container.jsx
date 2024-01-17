import React from 'react';
import { withTracker } from 'meteor/react-meteor-data';
import { useMutation } from '@apollo/client';
import Timer from './component';
import Service from './service';
import { layoutSelectInput, layoutDispatch } from '/imports/ui/components/layout/context';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import { TIMER_RESET, TIMER_START, TIMER_STOP } from './mutations';

const TimerContainer = ({ children, ...props }) => {
  const layoutContextDispatch = layoutDispatch();
  const cameraDock = layoutSelectInput((i) => i.cameraDock);
  const { isResizing } = cameraDock;
  const { data: currentUserData } = useCurrentUser((user) => ({
    isModerator: user.isModerator,
  }));

  const isModerator = currentUserData?.isModerator;
  const [timerReset] = useMutation(TIMER_RESET);
  const [timerStart] = useMutation(TIMER_START);
  const [timerStop] = useMutation(TIMER_STOP);

  const startTimer = () => {
    timerStart();
  };

  const stopTimer = (accumulated) => {
    timerStop({ variables: { accumulated } });
  };

  return (
    <Timer {...{
      layoutContextDispatch,
      isResizing,
      isModerator,
      timerReset,
      startTimer,
      stopTimer,
      ...props,
    }}
    >
      {children}
    </Timer>
  );
};

export default withTracker(() => {
  const isRTL = document.documentElement.getAttribute('dir') === 'rtl';
  return {
    isRTL,
    isActive: Service.isActive(),
    timeOffset: Service.getTimeOffset(),
    timer: Service.getTimer(),
    currentTrack: Service.getCurrentTrack(),
  };
})(TimerContainer);
