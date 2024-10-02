const CI = process.env.CI === 'true';
const TIMEOUT_MULTIPLIER = Number(process.env.TIMEOUT_MULTIPLIER);
const MULTIPLIER = CI ? TIMEOUT_MULTIPLIER || 2 : TIMEOUT_MULTIPLIER || 1;

// GLOBAL TESTS VARS
exports.ELEMENT_WAIT_TIME = 5000 * MULTIPLIER;
exports.ELEMENT_WAIT_LONGER_TIME = 10000 * MULTIPLIER;
exports.ELEMENT_WAIT_EXTRA_LONG_TIME = 15000 * MULTIPLIER;
exports.LOOP_INTERVAL = 1200;

// STRESS TESTS VARS
exports.JOIN_AS_MODERATOR_TEST_ROUNDS = 15;
exports.MAX_JOIN_AS_MODERATOR_FAIL_RATE = 0.05;
exports.BREAKOUT_ROOM_INVITATION_TEST_ROUNDS = 20;
exports.JOIN_TWO_USERS_ROUNDS = 20;
exports.JOIN_TWO_USERS_KEEPING_CONNECTED_ROUNDS = 20;
exports.JOIN_TWO_USERS_EXCEEDING_MAX_PARTICIPANTS = 20;
exports.MAX_PARTICIPANTS_TO_JOIN = 4;

// MEDIA CONNECTION TIMEOUTS
exports.VIDEO_LOADING_WAIT_TIME = 15000;
exports.UPLOAD_PDF_WAIT_TIME = 25000 * MULTIPLIER;

exports.CUSTOM_MEETING_ID = 'custom-meeting';
// it only works for snapshot comparisons. playwright assertions will complain about the element (still in the DOM)
exports.PARAMETER_HIDE_PRESENTATION_TOAST = 'userdata-bbb_custom_style=.presentationUploaderToast{display: none;}.currentPresentationToast{display:none;}';
