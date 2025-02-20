import * as React from 'react';
import PropTypes from 'prop-types';
import { useRef, useCallback, useState } from 'react';
import { isEqual } from 'radash';
import {
  Tldraw,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultHorizontalAlignStyle,
  DefaultVerticalAlignStyle,
  InstancePresenceRecordType,
  setDefaultUiAssetUrls,
  setDefaultEditorAssetUrls,
} from '@bigbluebutton/tldraw';
import '@bigbluebutton/tldraw/tldraw.css';
// eslint-disable-next-line import/no-extraneous-dependencies
import { compressToBase64, decompressFromBase64 } from 'lz-string';
import SlideCalcUtil, { HUNDRED_PERCENT } from '/imports/utils/slideCalcUtils';
import meetingClientSettingsInitialValues from '/imports/ui/core/initial-values/meetingClientSettings';
import getFromUserSettings from '/imports/ui/services/users-settings';
import KEY_CODES from '/imports/utils/keyCodes';
import { debounce } from '/imports/utils/debounce';
import logger from '/imports/startup/client/logger';
import Styled from './styles';
import {
  mapLanguage,
  isValidShapeType,
  usePrevious,
  getDifferences,
} from './utils';
import { useMouseEvents, useCursor } from './hooks';
import { notifyShapeNumberExceeded, getCustomEditorAssetUrls, getCustomAssetUrls } from './service';

import NoopTool from './custom-tools/noop-tool/component';

const CAMERA_TYPE = 'camera';

// Helper functions
const deleteLocalStorageItemsWithPrefix = (prefix) => {
  const keysToRemove = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
  keysToRemove.forEach((key) => localStorage.removeItem(key));
};

// Example of typical LocalStorage entry tldraw creates:
// `{ TLDRAW_USER_DATA_v3: '{"version":2,"user":{"id":"epDk1 ...`
const clearTldrawCache = () => {
  deleteLocalStorageItemsWithPrefix('TLDRAW');
};

const createCamera = (pageId, zoomLevel) => ({
  id: `camera:page:${pageId}`,
  meta: {},
  typeName: CAMERA_TYPE,
  x: 0,
  y: 0,
  z: zoomLevel,
});

const createLookup = (arr) =>
  arr.reduce((acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  }, {});

const defaultUser = {
  userId: '',
};

const Whiteboard = React.memo((props) => {
  const {
    isPresenter = false,
    removeShapes,
    persistShapeWrapper,
    shapes,
    removedShapes,
    assets,
    currentUser = defaultUser,
    whiteboardId = undefined,
    zoomSlide,
    curPageNum: curPageId,
    zoomChanger,
    isMultiUserActive,
    isRTL,
    fitToWidth,
    zoomValue,
    colorStyle,
    dashStyle,
    fillStyle,
    fontStyle,
    sizeStyle,
    presentationAreaHeight,
    presentationAreaWidth,
    setTldrawIsMounting,
    setTldrawAPI,
    whiteboardToolbarAutoHide,
    toggleToolsAnimations,
    animations,
    isToolbarVisible,
    isModerator,
    currentPresentationPage,
    presentationId = undefined,
    hasWBAccess,
    bgShape,
    publishCursorUpdate,
    otherCursors,
    hideViewersCursor,
    presentationWidth,
    presentationHeight,
    skipToSlide,
    intl,
    maxNumberOfAnnotations,
    notifyNotAllowedChange,
    locale,
    darkTheme,
    selectedLayout,
    isInfiniteWhiteboard,
    whiteboardWriters,
    isPhone,
    setEditor,
  } = props;

  clearTldrawCache();

  const [isMounting, setIsMounting] = React.useState(true);

  if (isMounting) {
    setDefaultEditorAssetUrls(getCustomEditorAssetUrls());
    setDefaultUiAssetUrls(getCustomAssetUrls());
  }

  const whiteboardRef = React.useRef(null);
  const zoomValueRef = React.useRef(null);
  const prevShapesRef = React.useRef(shapes);
  const tlEditorRef = React.useRef(null);
  const slideChanged = React.useRef(false);
  const slideNext = React.useRef(null);
  const prevZoomValueRef = React.useRef(null);
  const initialZoomRef = useRef(null);
  const isMouseDownRef = useRef(false);
  const shapeBatchRef = useRef({});
  const isMountedRef = useRef(false);
  const isWheelZoomRef = useRef(false);
  const isPresenterRef = useRef(isPresenter);
  const fitToWidthRef = useRef(fitToWidth);
  const whiteboardIdRef = React.useRef(whiteboardId);
  const curPageIdRef = React.useRef(curPageId);
  const hasWBAccessRef = React.useRef(hasWBAccess);
  const isModeratorRef = React.useRef(isModerator);
  const currentPresentationPageRef = React.useRef(currentPresentationPage);
  const initialViewBoxWidthRef = React.useRef(null);
  const initialViewBoxHeightRef = React.useRef(null);
  const previousTool = React.useRef(null);
  const bgSelectedRef = React.useRef(false);
  const lastVisibilityStateRef = React.useRef('');
  const mountedTimeoutIdRef = useRef(null);
  const presentationIdRef = React.useRef(presentationId);

  const [pageZoomMap, setPageZoomMap] = useState(() => {
    try {
      const saved = localStorage.getItem('pageZoomMap');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const customTools = [NoopTool];

  const prevFitToWidth = usePrevious(fitToWidth);
  const presenterChanged = usePrevious(isPresenter) !== isPresenter;
  const pageChanged = usePrevious(curPageId) !== curPageId;

  let clipboardContent = null;
  let isPasting = false;
  let pasteTimeout = null;

  const setIsMouseDown = (val) => {
    isMouseDownRef.current = val;
  };

  const setIsWheelZoom = (val) => {
    isWheelZoomRef.current = val;
  };

  const setWheelZoomTimeout = () => {
    isWheelZoomRef.currentTimeout = setTimeout(() => {
      setIsWheelZoom(false);
    }, 300);
  };

  const sanitizeShape = (shape) => {
    const { isModerator, questionType, ...rest } = shape;
    return {
      ...rest,
    };
  };

  const debouncedUpdateShapes = debounce(() => {
    if (shapes && Object.keys(shapes).length > 0) {
      prevShapesRef.current = shapes;
      tlEditorRef.current?.store.mergeRemoteChanges(() => {
        const remoteShapesArray = Object.values(prevShapesRef.current).reduce((acc, shape) => {
          if (shape.meta?.presentationId === presentationIdRef.current || shape?.whiteboardId?.includes(presentationIdRef.current)) {
            acc.push(sanitizeShape(shape));
          }
          return acc;
        }, []);

        if (pageChanged) {
          cleanupStore(`page:${parseInt(curPageIdRef.current, 10)}`);
          tlEditorRef.current?.store.put(assets);
          tlEditorRef.current?.store.put(bgShape);
        }

        tlEditorRef.current?.store.put(remoteShapesArray);
      });
    }
  }, 175);

  React.useEffect(() => {
    localStorage.setItem('pageZoomMap', JSON.stringify(pageZoomMap));
  }, [pageZoomMap]);

  React.useEffect(() => {
    currentPresentationPageRef.current = currentPresentationPage;
  }, [currentPresentationPage]);

  React.useEffect(() => {
    curPageIdRef.current = curPageId;
  }, [curPageId]);

  React.useEffect(() => {
    isModeratorRef.current = isModerator;
  }, [isModerator]);

  React.useEffect(() => {
    whiteboardIdRef.current = whiteboardId;
  }, [whiteboardId]);

  React.useEffect(() => {
    presentationIdRef.current = presentationId;
  }, [presentationId]);

  React.useEffect(() => {
    hasWBAccessRef.current = hasWBAccess;

    if (!hasWBAccess && !isPresenter) {
      tlEditorRef?.current?.setCurrentTool('noop');
    } else if (hasWBAccess && !isPresenter) {
      tlEditorRef?.current?.setCurrentTool('draw');
    }
  }, [hasWBAccess]);

  React.useEffect(() => {
    isPresenterRef.current = isPresenter;

    if (!hasWBAccessRef.current && !isPresenter) {
      tlEditorRef?.current?.setCurrentTool('noop');
    }
  }, [isPresenter]);

  React.useEffect(() => {
    fitToWidthRef.current = fitToWidth;
  }, [fitToWidth]);

  React.useEffect(() => {
    debouncedUpdateShapes();
  }, [shapes]);

  React.useEffect(() => {
    if (removedShapes && removedShapes.length > 0) {
      tlEditorRef.current?.store.remove([...removedShapes]);
    }
  }, [removedShapes]);

  const handleCopy = useCallback(() => {
    const selectedShapes = tlEditorRef.current?.getSelectedShapes();
    if (!selectedShapes || selectedShapes.length === 0) {
      return;
    }
    const content = tlEditorRef.current?.getContentFromCurrentPage(
      selectedShapes.map((shape) => shape.id),
    );
    if (content) {
      clipboardContent = content;
      const stringifiedClipboard = compressToBase64(
        JSON.stringify({
          type: 'application/tldraw',
          kind: 'content',
          data: content,
        }),
      );

      if (navigator.clipboard?.write) {
        const htmlBlob = new Blob([`<tldraw>${stringifiedClipboard}</tldraw>`], {
          type: 'text/html',
        });

        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': new Blob([''], { type: 'text/plain' }),
          }),
        ]);
      } else if (navigator.clipboard.writeText) {
        navigator.clipboard.writeText(`<tldraw>${stringifiedClipboard}</tldraw>`);
      }
    }
  }, [tlEditorRef]);

  const handleCut = useCallback((shouldCopy) => {
    const selectedShapes = tlEditorRef.current?.getSelectedShapes();
    if (!selectedShapes || selectedShapes.length === 0) {
      return;
    }
    if (shouldCopy) {
      handleCopy();
    }
    tlEditorRef.current?.deleteShapes(selectedShapes.map((shape) => shape.id));
  }, [tlEditorRef]);

  const pasteTldrawContent = (editor, clipboard, point) => {
    const p = point ?? (editor.inputs.shiftKey ? editor.inputs.currentPagePoint : undefined);
    editor.mark('paste');
    editor.putContentOntoCurrentPage(clipboard, {
      point: p,
      select: true,
    });
  };

  const handlePaste = useCallback(() => {
    if (isPasting) {
      return;
    }
    isPasting = true;

    clearTimeout(pasteTimeout);
    pasteTimeout = setTimeout(() => {
      if (clipboardContent) {
        pasteTldrawContent(tlEditorRef.current, clipboardContent);
        isPasting = false;
      } else {
        navigator.clipboard.readText().then((text) => {
          const match = text.match(/<tldraw>(.*)<\/tldraw>/);
          if (match && match[1]) {
            const content = JSON.parse(decompressFromBase64(match[1]));
            pasteTldrawContent(tlEditorRef.current, content);
          }
          isPasting = false;
        }).catch(() => {
          isPasting = false;
        });
      }
    }, 100);
  }, [tlEditorRef]);

  const handleKeyDown = useCallback((event) => {
    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // ignore if the edit link dialog is open
    if (document.querySelector('h2.tlui-dialog__header__title')?.textContent === 'Edit link') {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'escape' || event.keyCode === 27) {
      tlEditorRef.current?.deselect(...tlEditorRef.current?.getSelectedShapes());
      return;
    }

    const editingShape = tlEditorRef.current?.getEditingShape();
    if (editingShape && (isPresenterRef.current || hasWBAccessRef.current)) {
      return;
    }

    if (['delete', 'backspace'].includes(key.toLowerCase())) {
      handleCut(false);
      return;
    }

    if (key === ' ' && tlEditorRef.current?.getCurrentToolId() !== 'hand' && isPresenterRef.current) {
      previousTool.current = tlEditorRef.current?.getCurrentToolId();
      tlEditorRef.current?.setCurrentTool('hand');
      return;
    }

    // Mapping of simple key shortcuts to tldraw functions
    const simpleKeyMap = {
      v: () => tlEditorRef.current?.setCurrentTool('select'),
      d: () => tlEditorRef.current?.setCurrentTool('draw'),
      e: () => tlEditorRef.current?.setCurrentTool('eraser'),
      h: () => {
        if (isPresenterRef.current) {
          tlEditorRef.current?.setCurrentTool('hand');
        }
      },
      r: () => tlEditorRef.current?.setCurrentTool('rectangle'),
      o: () => tlEditorRef.current?.setCurrentTool('ellipse'),
      a: () => tlEditorRef.current?.setCurrentTool('arrow'),
      l: () => tlEditorRef.current?.setCurrentTool('line'),
      t: () => tlEditorRef.current?.setCurrentTool('text'),
      f: () => tlEditorRef.current?.setCurrentTool('frame'),
      n: () => tlEditorRef.current?.setCurrentTool('note'),
    };

    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          // Redo (Ctrl + Shift + z)
          tlEditorRef.current?.redo();
        } else {
          // Undo (Ctrl + z)
          tlEditorRef.current?.undo();
        }
        return;
      }

      const ctrlKeyMap = {
        a: () => {
          tlEditorRef.current?.selectAll();
          tlEditorRef.current?.setCurrentTool('select');
        },
        d: () => {
          tlEditorRef.current
            ?.duplicateShapes(tlEditorRef.current?.getSelectedShapes(), { x: 35, y: 35 });
          tlEditorRef.current?.selectNone();
        },
        x: () => {
          handleCut(true);
        },
        c: () => {
          handleCopy();
        },
        v: () => {
          if (!isPasting) {
            handlePaste();
          }
        },
      };

      if (ctrlKeyMap[key]) {
        event.preventDefault();
        event.stopPropagation();
        ctrlKeyMap[key]();
        return;
      }
    }

    if (!event.altKey && !event.ctrlKey && !event.shiftKey && simpleKeyMap[key]) {
      event.preventDefault();
      event.stopPropagation();
      simpleKeyMap[key]();
      return;
    }

    const moveDistance = 10;
    const selectedShapes = tlEditorRef.current?.getSelectedShapes().map((shape) => shape.id);

    const arrowKeyMap = {
      ArrowUp: { x: 0, y: -moveDistance },
      ArrowDown: { x: 0, y: moveDistance },
      ArrowLeft: { x: -moveDistance, y: 0 },
      ArrowRight: { x: moveDistance, y: 0 },
    };

    if (arrowKeyMap[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      tlEditorRef.current?.nudgeShapes(selectedShapes, arrowKeyMap[event.key], { squashing: true });
    }
  }, [
    tlEditorRef, isPresenterRef, hasWBAccessRef, previousTool, handleCut, handleCopy, handlePaste,
  ]);

  React.useEffect(() => {
    if (whiteboardRef.current) {
      whiteboardRef.current.addEventListener('keydown', handleKeyDown, {
        capture: true,
      });
    }

    return () => {
      whiteboardRef.current?.removeEventListener('keydown', handleKeyDown);
    };
  }, [whiteboardRef.current]);

  const language = React.useMemo(() => mapLanguage(locale?.toLowerCase() || 'en'), [locale]);

  const [cursorPosition, updateCursorPosition] = useCursor(
    publishCursorUpdate,
    whiteboardIdRef.current,
  );

  const setCamera = (zoom, x = 0, y = 0) => {
    if (tlEditorRef.current) {
      tlEditorRef.current.setCamera({ x, y, z: zoom }, { duration: 175 });
    }
  };

  const calculateZoomValue = (localWidth, localHeight) => {
    const calcedZoom = fitToWidth
      ? presentationAreaWidth / localWidth
      : Math.min(
        presentationAreaWidth / localWidth,
        presentationAreaHeight / localHeight,
      );

    return calcedZoom === 0 || calcedZoom === Infinity
      ? HUNDRED_PERCENT
      : calcedZoom;
  };

  const getContainerDimensions = () => {
    const container = document.querySelector('[data-test="presentationContainer"]');
    const innerWrapper = document.getElementById('presentationInnerWrapper');
    const containerWidth = container ? container.offsetWidth : 0;
    const innerWrapperWidth = innerWrapper ? innerWrapper.offsetWidth : 0;
    const widthGap = Math.max(containerWidth - innerWrapperWidth, 0);
    return { containerWidth, innerWrapperWidth, widthGap };
  }

  const coreCameraLogic = ({
    baseZoom,
    xOffset,
    yOffset,
    description,
    tlEditorRef,
    curPageIdRef,
  }) => {
    const throwIfInvalid = (value, desc) => {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${desc}: ${value}`);
      }
    };

    const validateCameraObject = (cam) => {
      try {
        throwIfInvalid(cam.x, 'camera.x');
        throwIfInvalid(cam.y, 'camera.y');
        throwIfInvalid(cam.z, 'camera.z');
      } catch (error) {
        logger.error(
          {
            logCode: 'ValidateCameraObject',
            extraInfo: {
              camera: cam,
            },
          },
          `Invalid camera object: ${error}`
        );
        return false;
      }
      return true;
    };

    throwIfInvalid(baseZoom, `baseZoom ${description}`);
    throwIfInvalid(xOffset, `camera.x ${description}`);
    throwIfInvalid(yOffset, `camera.y ${description}`);

    const camera = tlEditorRef.current.getCamera();
    const formattedPageId = Number(curPageIdRef.current);
    if (Number.isNaN(formattedPageId)) {
      throw new Error(`Invalid formattedPageId ${description}: ${formattedPageId}`);
    }

    const updatedCurrentCam = {
      ...camera,
      x: xOffset,
      y: yOffset,
      z: baseZoom,
    };

    tlEditorRef.current.store.put([updatedCurrentCam]);
  }

  const adjustCameraOnMount = (includeViewerLogic = true) => {
    try {
      if (presenterChanged) {
        localStorage.removeItem('initialViewBoxWidth');
        localStorage.removeItem('initialViewBoxHeight');
      }

      const storedWidth = localStorage.getItem('initialViewBoxWidth');
      const storedHeight = localStorage.getItem('initialViewBoxHeight');

      const throwIfInvalid = (val, desc) => {
        if (!Number.isFinite(val)) {
          throw new Error(`Invalid ${desc}: ${val}`);
        }
      };

      if (storedWidth && storedHeight) {
        const parsedWidth = parseFloat(storedWidth);
        const parsedHeight = parseFloat(storedHeight);
        throwIfInvalid(parsedWidth, 'stored initialViewBoxWidth');
        throwIfInvalid(parsedHeight, 'stored initialViewBoxHeight');

        initialViewBoxWidthRef.current = parsedWidth;
        initialViewBoxHeightRef.current = parsedHeight;
      } else {
        const currentPage = currentPresentationPageRef.current;
        const { scaledWidth, scaledHeight, scaledViewBoxWidth, scaledViewBoxHeight } = currentPage;

        if (scaledViewBoxWidth === 0 || scaledViewBoxHeight === 0) {
          throw new Error(
            `scaledViewBoxWidth or scaledViewBoxHeight is zero: ${scaledViewBoxWidth}, ${scaledViewBoxHeight}`
          );
        }

        const currentZoomLevel = scaledWidth / scaledViewBoxWidth;
        throwIfInvalid(currentZoomLevel, 'currentZoomLevel');

        const calculatedWidth =
          currentZoomLevel !== 1 ? scaledWidth / currentZoomLevel : scaledWidth;
        const calculatedHeight =
          currentZoomLevel !== 1 ? scaledHeight / currentZoomLevel : scaledHeight;

        throwIfInvalid(calculatedWidth, 'calculatedWidth');
        throwIfInvalid(calculatedHeight, 'calculatedHeight');

        initialViewBoxWidthRef.current = calculatedWidth;
        initialViewBoxHeightRef.current = calculatedHeight;

        try {
          localStorage.setItem('initialViewBoxWidth', calculatedWidth.toString());
          localStorage.setItem('initialViewBoxHeight', calculatedHeight.toString());
        } catch (error) {
          logger.warn(
            { logCode: 'InitialViewBoxStorage' },
            `Failed to store viewbox dimensions: ${error}`
          );
        }
      }

      const {
        scaledWidth,
        scaledHeight,
        scaledViewBoxWidth,
        scaledViewBoxHeight,
        xOffset,
        yOffset,
      } = currentPresentationPageRef.current;

      if (
        presentationAreaHeight > 0 &&
        presentationAreaWidth > 0 &&
        scaledWidth > 0 &&
        scaledHeight > 0 &&
        tlEditorRef.current
      ) {
        const adjustedPresentationAreaHeight = isPresenterRef.current
          ? presentationAreaHeight - 40
          : presentationAreaHeight;

        let baseZoom = calculateZoomValue(scaledWidth, scaledHeight);
        throwIfInvalid(baseZoom, 'baseZoom');

        if (isPresenterRef.current) {
          const { containerWidth, innerWrapperWidth, widthGap } = getContainerDimensions();

          if (widthGap > 0) {
            const zoomWithGap = calculateZoomWithGapValue(scaledWidth, scaledHeight, widthGap);
            throwIfInvalid(zoomWithGap, 'zoomWithGap');
            baseZoom = zoomWithGap;
          }

          coreCameraLogic({
            baseZoom,
            xOffset,
            yOffset,
            description: '(presenter)',
            tlEditorRef,
            curPageIdRef,
          });
        } else if (includeViewerLogic) {
          // Viewer logic
          baseZoom = calculateZoomValue(scaledViewBoxWidth, scaledViewBoxHeight);
          coreCameraLogic({
            baseZoom,
            xOffset,
            yOffset,
            description: '(viewer)',
            tlEditorRef,
            curPageIdRef,
          });
        }

        isMountedRef.current = true;
      }
    } catch (error) {
      logger.error({ logCode: 'AdjustCameraOnMount' }, `Failed to store viewbox: ${error}`);
      throw error;
    }
  }

  const pollInnerWrapperDimensionsUntilStable = (
    onReady,
    options = {
      maxTries: 120,
      stabilityFrames: 50,
    },
    currentTry = 0,
    stableCount = 0,
    lastDimensions = { width: 0, height: 0 }
  ) => {
    const container = document.querySelector('[data-test="presentationContainer"]');
    const innerWrapper = document.getElementById('presentationInnerWrapper');

    const containerWidth = container ? container.offsetWidth : 0;
    const containerHeight = container ? container.offsetHeight : 0;
    const innerWrapperWidth = innerWrapper ? innerWrapper.offsetWidth : 0;
    const innerWrapperHeight = innerWrapper ? innerWrapper.offsetHeight : 0;

    if (innerWrapperWidth <= 0 || innerWrapperHeight <= 0) {
      stableCount = 0;
    } else {
      if (
        innerWrapperWidth === lastDimensions.width &&
        innerWrapperHeight === lastDimensions.height
      ) {
        stableCount++;
      } else {
        stableCount = 0;
        lastDimensions = { width: innerWrapperWidth, height: innerWrapperHeight };
      }
    }

    if (stableCount >= options.stabilityFrames) {
      onReady({ containerWidth, containerHeight, innerWrapperWidth, innerWrapperHeight });
      return;
    }

    if (currentTry < options.maxTries) {
      requestAnimationFrame(() => {
        pollInnerWrapperDimensionsUntilStable(
          onReady,
          options,
          currentTry + 1,
          stableCount,
          lastDimensions
        );
      });
    } else {
      logger.warn(
        { logCode: 'pollInnerWrapperDimensionsUntilStable' },
        `Failed to store viewbox dimensions`
      );
      onReady({ containerWidth, containerHeight, innerWrapperWidth, innerWrapperHeight });
    }
  };

  const handleTldrawMount = (editor) => {
    tlEditorRef.current = editor;
    setTldrawAPI(editor);
    setEditor(editor);

    DefaultHorizontalAlignStyle.defaultValue = isRTL ? 'end' : 'start';
    DefaultVerticalAlignStyle.defaultValue = 'start';

    editor?.user?.updateUserPreferences({ locale: language });

    const colorStyles = [
      'black',
      'blue',
      'green',
      'grey',
      'light-blue',
      'light-green',
      'light-red',
      'light-violet',
      'orange',
      'red',
      'violet',
      'yellow',
    ];
    const dashStyles = ['dashed', 'dotted', 'draw', 'solid'];
    const fillStyles = ['none', 'pattern', 'semi', 'solid'];
    const fontStyles = ['draw', 'mono', 'sans', 'serif'];
    const sizeStyles = ['l', 'm', 's', 'xl'];

    if (colorStyles.includes(colorStyle)) {
      editor.setStyleForNextShapes(DefaultColorStyle, colorStyle);
    }
    if (dashStyles.includes(dashStyle)) {
      editor.setStyleForNextShapes(DefaultDashStyle, dashStyle);
    }
    if (fillStyles.includes(fillStyle)) {
      editor.setStyleForNextShapes(DefaultFillStyle, fillStyle);
    }
    if (fontStyles.includes(fontStyle)) {
      editor.setStyleForNextShapes(DefaultFontStyle, fontStyle);
    }
    if (sizeStyles.includes(sizeStyle)) {
      editor.setStyleForNextShapes(DefaultSizeStyle, sizeStyle);
    }

    editor.store.listen(
      (entry) => {
        const { changes } = entry;
        const { added, updated, removed } = changes;

        const addedCount = Object.keys(added).length;
        const localShapes = editor.getCurrentPageShapes();
        const filteredShapes = localShapes?.filter((item) => item?.index !== 'a0') || [];
        const shapeNumberExceeded = filteredShapes
          .length + addedCount - 1 > maxNumberOfAnnotations;
        const invalidShapeType = Object.keys(added).find((id) => !isValidShapeType(added[id]));

        if (addedCount > 0 && (shapeNumberExceeded || invalidShapeType)) {
          // notify and undo last command without persisting
          // to not generate the onUndo/onRedo callback
          if (shapeNumberExceeded) {
            notifyShapeNumberExceeded(intl, maxNumberOfAnnotations);
          } else {
            notifyNotAllowedChange(intl);
          }
          // use remote to not trigger unwanted updates
          editor.store.mergeRemoteChanges(() => {
            editor.history.undo({ persist: false });
            const tool = editor.getCurrentToolId();
            editor.setCurrentTool('noop');
            editor.setCurrentTool(tool);
          });
        } else {
          // Add new shapes to the batch
          Object.values(added).forEach((record) => {
            const updatedRecord = {
              ...record,
              meta: {
                ...record.meta,
                createdBy: currentUser?.userId,
                presentationId: presentationIdRef.current,
              },
            };

            shapeBatchRef.current[updatedRecord.id] = updatedRecord;
          });
        }

        // Update existing shapes and add them to the batch
        Object.values(updated).forEach(([, record]) => {
          const formattedLookup = createLookup(editor.getCurrentPageShapes());
          const createdBy = formattedLookup[record?.id]?.meta?.createdBy || currentUser?.userId;
          const updatedRecord = {
            ...record,
            meta: {
              createdBy,
              updatedBy: currentUser?.userId,
              presentationId: presentationIdRef.current,
            },
          };

          const diff = getDifferences(prevShapesRef.current[record?.id], updatedRecord);

          if (diff) {
            diff.id = record.id;

            shapeBatchRef.current[updatedRecord.id] = diff;
          } else {
            shapeBatchRef.current[updatedRecord.id] = updatedRecord;
          }
        });

        // Handle removed shapes immediately (not batched)
        const idsToRemove = Object.keys(removed);
        if (idsToRemove.length > 0) {
          removeShapes(idsToRemove);
        }
      },
      { source: 'user', scope: 'document' },
    );

    editor.store.listen(
      (entry) => {
        const { changes } = entry;
        const { updated } = changes;
        const { 'pointer:pointer': pointers } = updated;

        const path = editor.getPath();

        if ((isPresenterRef.current || hasWBAccessRef.current) && pointers) {
          const [, nextPointer] = pointers;
          updateCursorPosition(nextPointer?.x, nextPointer?.y);
        }

        const camKey = `camera:page:${curPageIdRef.current}`;
        const { [camKey]: cameras } = updated;

        if (cameras) {
          const [prevCam, nextCam] = cameras;
          const panned = prevCam.x !== nextCam.x || prevCam.y !== nextCam.y;

          const zoomed = prevCam.z !== nextCam.z;

          if ((panned || (zoomed && fitToWidthRef.current)) && isPresenterRef.current) {
            const viewedRegionW = SlideCalcUtil.calcViewedRegionWidth(
              editor?.getViewportPageBounds()?.w,
              currentPresentationPageRef.current?.scaledWidth,
            );
            const viewedRegionH = SlideCalcUtil.calcViewedRegionHeight(
              editor?.getViewportPageBounds()?.h,
              currentPresentationPageRef.current?.scaledHeight,
            );

            if (isMountedRef.current) {
              zoomSlide(
                viewedRegionW, viewedRegionH, nextCam.x, nextCam.y,
                currentPresentationPageRef.current,
              );
            }
          }
        }

        // Check for idle states and persist the batch if there are shapes
        if (path === 'select.idle' || path === 'draw.idle' || path === 'select.editing_shape' || path === 'highlight.idle') {
          if (Object.keys(shapeBatchRef.current).length > 0) {
            const shapesToPersist = Object.values(shapeBatchRef.current);
            shapesToPersist.forEach((shape) => {
              persistShapeWrapper(
                shape,
                whiteboardIdRef.current,
                isModeratorRef.current,
              );
            });

            shapeBatchRef.current = {};
          }
        }
      },
      { source: 'user' },
    );

    if (editor && curPageIdRef.current) {
      const page = [];
      const formattedPageId = parseInt(curPageIdRef.current, 10);
      const currentPageId = `page:${formattedPageId}`;
      const currPageExists = tlEditorRef.current?.getPage(currentPageId);

      if (!currPageExists) {
        const currentPage = createPage(currentPageId);
        page.push(...currentPage);
      }

      const hasShapes = shapes && Object.keys(shapes).length > 0;
      const remoteShapesArray = hasShapes 
        ? Object.values(shapes).map((shape) => sanitizeShape(shape))
        : [];

      editor.store.mergeRemoteChanges(() => {
        editor.batch(() => {
          editor.store.put(page);
          editor.store.put(assets);
          editor.setCurrentPage(`page:${curPageIdRef.current}`);
          editor.store.put(bgShape);
          if (hasShapes) {
            editor.store.put(remoteShapesArray);
          }
          editor.history.clear();
        });
      });

      // eslint-disable-next-line no-param-reassign
      editor.store.onBeforeChange = (prev, next) => {
        if (isPhone) {
          const path = editor.getPath();
          const activePaths = [
            'draw.drawing',
            'eraser.erasing',
            'select.dragging_handle',
            'select.resizing',
            'select.translating',
            'select.rotating',
            'select.editing_shape',
            'hand.pointing',
            'hand.dragging',
            'geo.pointing',
            'line.pointing',
            'highlight.drawing',
          ];
          const idlePaths = [
            'draw.idle',
            'eraser.idle',
            'select.idle',
            'hand.idle',
            'highlight.idle',
          ];

          let visibilityState = null;
          if (activePaths.includes(path)) {
            visibilityState = 'visible';
          } else if (idlePaths.includes(path)) {
            visibilityState = 'hidden';
          }

          if (visibilityState && visibilityState !== lastVisibilityStateRef.current) {
            if (visibilityState === 'visible') {
              toggleToolsAnimations(
                'fade-in',
                'fade-out',
                '0s',
                hasWBAccessRef.current || isPresenterRef.current,
              );
            } else if (visibilityState === 'hidden') {
              toggleToolsAnimations(
                'fade-out',
                'fade-in',
                '0s',
                hasWBAccessRef.current || isPresenterRef.current,
              );
            }
            lastVisibilityStateRef.current = visibilityState;
          }
        }

        const newNext = next;
        if (next?.typeName === 'instance_page_state') {
          if (isPresenterRef.current || isModeratorRef.current) return next;
          const formattedLookup = createLookup(editor.getCurrentPageShapes());

          // Filter selectedShapeIds based on shape owner
          if (next.selectedShapeIds.length > 0) {
            newNext.selectedShapeIds = next.selectedShapeIds.filter((shapeId) => {
              const shapeOwner = formattedLookup[shapeId]?.meta?.createdBy;
              return !shapeOwner || shapeOwner === currentUser?.userId;
            });
          }

          if (!isEqual(prev.hoveredShapeId, next.hoveredShapeId)) {
            const hoveredShapeOwner = formattedLookup[next.hoveredShapeId]?.meta?.createdBy;
            if (hoveredShapeOwner !== currentUser?.userId || next.hoveredShapeId?.includes('shape:BG-')) {
              newNext.hoveredShapeId = null;
            }
          }

          return newNext;
        }

        // Get viewport dimensions and bounds
        let viewportWidth;
        let viewportHeight;

        if (isPresenterRef.current) {
          const viewportPageBounds = editor?.getViewportPageBounds();
          viewportWidth = viewportPageBounds?.w;
          viewportHeight = viewportPageBounds?.h;
        } else {
          viewportWidth = currentPresentationPageRef.current?.scaledViewBoxWidth;
          viewportHeight = currentPresentationPageRef.current?.scaledViewBoxHeight;
        }

        const presentationWidthLocal = currentPresentationPageRef.current?.scaledWidth || 0;
        const presentationHeightLocal = currentPresentationPageRef.current?.scaledHeight || 0;

        // Adjust camera position to ensure it stays within bounds
        const panned = next?.id?.includes('camera') && (prev.x !== next.x || prev.y !== next.y);
        if (panned && !currentPresentationPageRef.current?.infiniteWhiteboard) {
          // Horizontal bounds check
          if (next.x > 0) {
            newNext.x = 0;
          } else if (next.x < -(presentationWidthLocal - viewportWidth)) {
            newNext.x = -(presentationWidthLocal - viewportWidth);
          }

          // Vertical bounds check
          if (next.y > 0) {
            newNext.y = 0;
          } else if (next.y < -(presentationHeightLocal - viewportHeight)) {
            newNext.y = -(presentationHeightLocal - viewportHeight);
          }
        }

        return newNext;
      };

      // eslint-disable-next-line no-param-reassign
      editor.store.onAfterChange = (prev, next) => {
        if (next.selectedShapeIds && next.selectedShapeIds?.some((id) => id.includes('shape:BG'))) {
          bgSelectedRef.current = true;
        } else if ((next.selectedShapeIds && !next.selectedShapeIds?.some((id) => id.includes('shape:BG')))) {
          bgSelectedRef.current = false;
        }
      };

      if (!isPresenterRef.current && !hasWBAccessRef.current) {
        editor.setCurrentTool('noop');
      }
    }

    pollInnerWrapperDimensionsUntilStable(() => {
      adjustCameraOnMount(!isPresenterRef.current);
    });
  };

  const calculateZoomWithGapValue = (
    localWidth,
    localHeight,
    widthAdjustment = 0,
  ) => {
    const presentationWidthLocal = presentationAreaWidth - widthAdjustment;
    const calcedZoom = (fitToWidth
      ? presentationWidthLocal / localWidth
      : Math.min(
        presentationWidthLocal / localWidth,
        presentationAreaHeight / localHeight,
      ));
    return calcedZoom === 0 || calcedZoom === Infinity
      ? HUNDRED_PERCENT
      : calcedZoom;
  };

  const syncCameraOnPresenterZoom = ({
    tlEditorRef,
    curPageIdRef,
    currentPresentationPageRef,
    zoomValueRef,
    fitToWidthRef,
    initialZoomRef,
  }) => {
    if (
      !tlEditorRef.current ||
      !curPageIdRef.current ||
      !currentPresentationPageRef.current
    ) {
      return;
    }

    let zoomLevelForReset;
    if (fitToWidthRef.current || !initialZoomRef.current) {
      zoomLevelForReset = calculateZoomValue(
        currentPresentationPageRef.current.scaledWidth,
        currentPresentationPageRef.current.scaledHeight
      );
    } else {
      zoomLevelForReset = initialZoomRef.current;
    }

    const { containerWidth, innerWrapperWidth, widthGap } = getContainerDimensions();

    if (widthGap > 0) {
      zoomLevelForReset = calculateZoomWithGapValue(
        currentPresentationPageRef.current.scaledWidth,
        currentPresentationPageRef.current.scaledHeight,
        widthGap
      );
    }

    const zoomCamera = (zoomLevelForReset * zoomValueRef.current) / HUNDRED_PERCENT;
    const slideShape = tlEditorRef.current.getShape(`shape:BG-${curPageIdRef.current}`);
    const camera = tlEditorRef.current.getCamera();
    const viewportScreenBounds = tlEditorRef.current.getViewportScreenBounds();
    const viewportWidth = viewportScreenBounds.width;
    const viewportHeight = viewportScreenBounds.height;
    let newCamera;

    if (slideShape) {
      const prevZoomCamera = camera.z;
      const prevCenteredCameraX =
        -slideShape.x +
        (viewportWidth - slideShape.props.w * prevZoomCamera) / (2 * prevZoomCamera);
      const prevCenteredCameraY =
        -slideShape.y +
        (viewportHeight - slideShape.props.h * prevZoomCamera) / (2 * prevZoomCamera);

      const panningOffsetX = camera.x - prevCenteredCameraX;
      const panningOffsetY = camera.y - prevCenteredCameraY;

      const centeredCameraX =
        -slideShape.x +
        (viewportWidth - slideShape.props.w * zoomCamera) / (2 * zoomCamera);
      const centeredCameraY =
        -slideShape.y +
        (viewportHeight - slideShape.props.h * zoomCamera) / (2 * zoomCamera);

      newCamera = {
        x: centeredCameraX + panningOffsetX,
        y: centeredCameraY + panningOffsetY,
        z: zoomCamera,
      };
    } else {
      newCamera = {
        x: camera.x + ((viewportWidth / 2) / camera.z - (viewportWidth / 2) / zoomCamera),
        y: camera.y + ((viewportHeight / 2) / camera.z - (viewportHeight / 2) / zoomCamera),
        z: zoomCamera,
      };
    }

    if (newCamera) {
      tlEditorRef.current.setCamera(newCamera, { duration: 175 });
    }
  }

  const syncCameraWithPresentationArea = ({
    tlEditorRef,
    isPresenter,
    currentPresentationPageRef,
    presentationAreaWidth,
    presentationAreaHeight,
    zoomValueRef,
    fitToWidthRef,
    curPageIdRef,
    initialViewBoxWidthRef,
    initialViewBoxHeightRef,
  }) => {
    if (
      !tlEditorRef.current ||
      !currentPresentationPageRef.current ||
      presentationAreaWidth <= 0 ||
      presentationAreaHeight <= 0
    ) {
      return;
    }

    const currentZoom = zoomValueRef.current || HUNDRED_PERCENT;
    const {
      scaledWidth,
      scaledHeight,
      scaledViewBoxWidth,
      scaledViewBoxHeight,
    } = currentPresentationPageRef.current;

    if (scaledWidth <= 0 || scaledHeight <= 0) {
      return;
    }

    const baseZoom = calculateZoomValue(scaledWidth, scaledHeight);

    let adjustedZoom = (baseZoom * currentZoom) / HUNDRED_PERCENT;

    if (isPresenter) {
      const { containerWidth, innerWrapperWidth, widthGap } = getContainerDimensions();

      if (widthGap > 0) {
        const gapZoom = calculateZoomWithGapValue(scaledWidth, scaledHeight, widthGap);
        adjustedZoom = (gapZoom * currentZoom) / HUNDRED_PERCENT;
      }

      const camera = tlEditorRef.current.getCamera();
      const formattedPageId = Number(curPageIdRef.current);
      const zoomToApply = adjustedZoom;
      const updatedCurrentCam = {
        ...camera,
        z: adjustedZoom,
      };
      tlEditorRef.current.store.put([updatedCurrentCam]);
    } else {
      const newZoom = calculateZoomValue(
        scaledViewBoxWidth,
        scaledViewBoxHeight
      );
      const camera = tlEditorRef.current.getCamera();
      const formattedPageId = Number(curPageIdRef.current);
      const updatedCurrentCam = {
        ...camera,
        z: newZoom,
      };
      tlEditorRef.current.store.put([updatedCurrentCam]);
    }
  }

  useMouseEvents(
    {
      whiteboardRef, tlEditorRef, isWheelZoomRef, initialZoomRef, isPresenterRef,
    },
    {
      hasWBAccess: hasWBAccessRef.current,
      whiteboardToolbarAutoHide,
      animations,
      publishCursorUpdate,
      whiteboardId: whiteboardIdRef.current,
      cursorPosition,
      updateCursorPosition,
      toggleToolsAnimations,
      currentPresentationPage,
      zoomChanger,
      setIsMouseDown,
      setIsWheelZoom,
      setWheelZoomTimeout,
      isInfiniteWhiteboard,
    },
  );

  React.useEffect(() => {
    const handleArrowPress = (event) => {
      const currPageNum = parseInt(curPageIdRef.current, 10);
      const shapeSelected = tlEditorRef.current.getSelectedShapes()?.length > 0;
      const changeSlide = (direction) => {
        if (!currentPresentationPage) return;
        const newSlideNum = currPageNum + direction;
        const outOfBounds = direction > 0
          ? newSlideNum > currentPresentationPage?.totalPages
          : newSlideNum < 1;

        if (outOfBounds) return;

        skipToSlide(newSlideNum);
        zoomChanger(HUNDRED_PERCENT);
        zoomSlide(HUNDRED_PERCENT, HUNDRED_PERCENT, 0, 0);
      };

      if (!shapeSelected) {
        if (event.keyCode === KEY_CODES.ARROW_RIGHT) {
          changeSlide(1); // Move to the next slide
        } else if (event.keyCode === KEY_CODES.ARROW_LEFT) {
          changeSlide(-1); // Move to the previous slide
        }
      }
    };

    const handleKeyDown2 = (event) => {
      if (
        (event.keyCode === KEY_CODES.ARROW_RIGHT
          || event.keyCode === KEY_CODES.ARROW_LEFT)
        && isPresenterRef.current
      ) {
        handleArrowPress(event);
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === ' ') {
        if (previousTool.current) {
          tlEditorRef.current?.setCurrentTool(previousTool.current);
          previousTool.current = null;
        }
      }
    };

    whiteboardRef.current?.addEventListener('keydown', handleKeyDown2, {
      capture: true,
    });
    whiteboardRef.current?.addEventListener('keyup', handleKeyUp, {
      capture: true,
    });

    return () => {
      whiteboardRef.current?.removeEventListener('keydown', handleKeyDown2);
      whiteboardRef.current?.removeEventListener('keyup', handleKeyUp);
    };
  }, [whiteboardRef.current]);

  React.useEffect(() => {
    zoomValueRef.current = zoomValue;
    setPageZoomMap(prev => ({
      ...prev,
      [curPageIdRef.current]: zoomValue,
    }));

    if (pageChanged) {
      return zoomChanger(pageZoomMap[curPageIdRef.current]||HUNDRED_PERCENT);
    }

    if (
      tlEditorRef.current &&
      curPageIdRef.current &&
      currentPresentationPage &&
      isPresenter &&
      !isWheelZoomRef.current
    ) {
      if (!isMounting) {
        syncCameraOnPresenterZoom({
          tlEditorRef,
          curPageIdRef,
          currentPresentationPageRef,
          zoomValueRef,
          fitToWidthRef,
          initialZoomRef,
        });
      }
    }
    prevZoomValueRef.current = zoomValue;
  }, [zoomValue, pageChanged, tlEditorRef.current, isWheelZoomRef.current]);

  React.useEffect(() => {
    if (isPresenter) {
      zoomChanger(HUNDRED_PERCENT);
      zoomSlide(HUNDRED_PERCENT, HUNDRED_PERCENT, 0, 0);
    }
  }, [fitToWidth, isPresenter]);

  React.useEffect(() => {
    if (
      currentPresentationPageRef.current.scaledWidth > 0 &&
      currentPresentationPageRef.current.scaledHeight > 0 &&
      presentationAreaWidth > 0 &&
      presentationAreaHeight > 0
    ) {
      const adjustedPresentationAreaHeight = isPresenterRef.current
        ? presentationAreaHeight - 40
        : presentationAreaHeight;
      const slideAspectRatio =
        currentPresentationPageRef.current.scaledWidth /
        currentPresentationPageRef.current.scaledHeight;
      const presentationAreaAspectRatio =
        presentationAreaWidth / adjustedPresentationAreaHeight;

      let initialZoom;

      if (
        slideAspectRatio > presentationAreaAspectRatio ||
        (fitToWidthRef.current && isPresenterRef.current)
      ) {
        initialZoom =
          presentationAreaWidth /
          currentPresentationPageRef.current.scaledWidth;
      } else {
        initialZoom =
          adjustedPresentationAreaHeight /
          currentPresentationPageRef.current.scaledHeight;
      }

      initialZoomRef.current = initialZoom;
      prevZoomValueRef.current = zoomValue;
    }
  }, [presentationAreaWidth, presentationAreaHeight, presentationWidth, presentationHeight, isPresenter, presentationId, fitToWidth]);

  React.useEffect(() => {
    const handleResize = () => {
      syncCameraWithPresentationArea({
        tlEditorRef,
        isPresenter,
        currentPresentationPageRef,
        presentationAreaWidth,
        presentationAreaHeight,
        zoomValueRef,
        fitToWidthRef,
        curPageIdRef,
        initialViewBoxWidthRef,
        initialViewBoxHeightRef,
      });
    };

    pollInnerWrapperDimensionsUntilStable(() => {
      syncCameraWithPresentationArea({
        tlEditorRef,
        isPresenter,
        currentPresentationPageRef,
        presentationAreaWidth,
        presentationAreaHeight,
        zoomValueRef,
        fitToWidthRef,
        curPageIdRef,
        initialViewBoxWidthRef,
        initialViewBoxHeightRef,
      });
    },{
        maxTries: 120,
        stabilityFrames: 35,
    });
  }, [presentationHeight, presentationWidth, curPageId, presentationId]);

  React.useEffect(() => {
    if (!isPresenter
      && tlEditorRef.current
      && initialViewBoxWidthRef.current
      && initialViewBoxHeightRef.current
      && currentPresentationPage
    ) {
      const newZoom = calculateZoomValue(
        currentPresentationPage.scaledViewBoxWidth,
        currentPresentationPage.scaledViewBoxHeight,
      );

      const adjustedXPos = currentPresentationPage.xOffset;
      const adjustedYPos = currentPresentationPage.yOffset;

      setCamera(
        newZoom,
        adjustedXPos,
        adjustedYPos,
      );
    }
  }, [currentPresentationPage, isPresenter]);

  React.useEffect(() => {
    if (tlEditorRef.current) {
      const useElement = document.querySelector('.tl-cursor use');
      if (useElement && !isMultiUserActive && !isPresenter) {
        useElement.setAttribute('href', '#redPointer');
      } else if (useElement) {
        useElement.setAttribute('href', '#cursor');
      }

      const idsToRemove = [];

      // Get all presence records from the store
      const allRecords = tlEditorRef.current.store.allRecords();
      const presenceRecords = allRecords.filter((record) => record.id.startsWith('instance_presence:'));

      // Check if any presence records correspond to users not in whiteboardWriters
      presenceRecords.forEach((record) => {
        const userId = record.userId.split('instance_presence:')[1];
        const hasAccessToWhiteboard = whiteboardWriters.some((writer) => writer.userId === userId);

        if (!hasAccessToWhiteboard) {
          idsToRemove.push(record.id);
        }
      });

      const updatedPresences = otherCursors
        .map(({
          userId, user, xPercent, yPercent,
        }) => {
          const { presenter, name } = user;
          const id = InstancePresenceRecordType.createId(userId);
          const active = xPercent !== -1 && yPercent !== -1;
          // if cursor is not active remove it from tldraw store
          if (
            !active
            || (hideViewersCursor
              && user.role === 'VIEWER'
              && !currentUser?.presenter)
            || (!presenter && !isMultiUserActive)
          ) {
            idsToRemove.push(id);
            return null;
          }

          const cursor = {
            x: xPercent,
            y: yPercent,
            type: 'default',
            rotation: 0,
          };
          const color = presenter ? '#FF0000' : '#70DB70';
          const c = {
            ...InstancePresenceRecordType.create({
              id,
              currentPageId: `page:${curPageIdRef.current}`,
              userId,
              userName: name,
              cursor,
              color,
            }),
            lastActivityTimestamp: Date.now(),
          };

          return c;
        })
        .filter((cursor) => cursor && cursor.userId !== currentUser?.userId);

      if (idsToRemove.length) {
        tlEditorRef.current?.store.remove(idsToRemove);
      }

      // If there are any updated presences, put them all in the store
      if (updatedPresences.length) {
        tlEditorRef.current?.store.put(updatedPresences);
      }
    }
  }, [otherCursors, whiteboardWriters]);

  const createPage = (currentPageId) => [
    {
      meta: {},
      id: currentPageId,
      name: `Slide ${currentPageId?.split(':')[1]}`,
      index: 'a1',
      typeName: 'page',
    },
  ];

  const createCameras = (pageId, tlZ) => {
    const cameras = [];
    const MIN_PAGE_ID = 1;
    const totalPages = currentPresentationPageRef.current?.totalPages || 1;

    if (pageId > MIN_PAGE_ID) {
      cameras.push(createCamera(pageId - 1, tlZ));
    }

    cameras.push(createCamera(pageId, tlZ));

    if (pageId < totalPages) {
      cameras.push(createCamera(pageId + 1, tlZ));
    }

    return cameras;
  };

  const cleanupStore = (currentPageId) => {
    const allRecords = tlEditorRef.current.store.allRecords();
    const shapeIdsToRemove = allRecords
      .filter((record) => {
        return record.typeName === 'shape' && record.parentId;
      })
      .filter((record) => {
        return record?.meta?.presentationId !== presentationIdRef.current || !record?.meta?.presentationId;
      })
      .map((shape) => shape.id);

    if (shapeIdsToRemove.length > 0) {
      tlEditorRef.current?.store.remove([...shapeIdsToRemove]);
    }
  };

  const updateStore = (pages, cameras) => {
    tlEditorRef.current.store.put(pages);
    tlEditorRef.current.store.put(cameras);
    tlEditorRef.current.store.put(assets);
    tlEditorRef.current.store.put(bgShape);
  };

  const finalizeStore = () => {
    tlEditorRef.current.history.clear();
  };

  const toggleToolbarIfNeeded = () => {
    if (whiteboardToolbarAutoHide && toggleToolsAnimations) {
      toggleToolsAnimations('fade-in', 'fade-out', '0s', hasWBAccessRef.current || isPresenterRef.current);
    }
  };

  const resetSlideState = () => {
    slideChanged.current = false;
    slideNext.current = null;
  };

  React.useEffect(() => {
    const formattedPageId = parseInt(curPageIdRef.current, 10);
    if (tlEditorRef.current && formattedPageId !== 0) {
      tlEditorRef.current.store.mergeRemoteChanges(() => {
        tlEditorRef.current.batch(() => {
          const currentPageId = `page:${formattedPageId}`;
          const tlZ = tlEditorRef.current.getCamera()?.z;
          const cameras = [];
          const pages = [];
          const currPageExists = tlEditorRef.current?.getPage(currentPageId);
          if (!currPageExists) {
            const currentPage = createPage(currentPageId);
            pages.push(...currentPage);
          }
          const allRecords = tlEditorRef.current.store.allRecords();
          const cameraRecords = allRecords.filter(record => record.typeName === "camera" && record.id?.split(':').pop() == formattedPageId);
          if (cameraRecords?.length < 1) {
            cameras.push(createCamera(formattedPageId, tlZ));
          }
          cleanupStore(currentPageId);
          updateStore(pages, cameras);
          tlEditorRef.current.setCurrentPage(currentPageId);
          finalizeStore();
        });
      });

      toggleToolbarIfNeeded();
      resetSlideState();
    }
  }, [curPageId]);

  React.useEffect(() => {
    setTldrawIsMounting(true);
    isPresenterRef?.current && zoomChanger(HUNDRED_PERCENT);
    return () => {
      isMountedRef.current = false;
      localStorage.removeItem('initialViewBoxWidth');
      localStorage.removeItem('initialViewBoxHeight');
      localStorage.removeItem('pageZoomMap');
      if (mountedTimeoutIdRef.current) {
        clearTimeout(mountedTimeoutIdRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (isMounting) {
      setIsMounting(false);
      /// brings presentation toolbar back
      setTldrawIsMounting(false);
    }
  }, [tlEditorRef?.current?.camera, presentationAreaWidth, presentationAreaHeight, presentationId]);

  React.useEffect(() => {
    const bbbMultiUserTools = getFromUserSettings(
      'bbb_multi_user_tools',
      meetingClientSettingsInitialValues.public.whiteboard.toolbar.multiUserTools,
    );
    const allElements = document.querySelectorAll('[data-testid^="tools."]');
    const actionsElement = document.querySelector('[data-testid="main.action-menu"]');

    if (bbbMultiUserTools.length >= 1 && !isModerator) {
      allElements.forEach((element) => {
        const toolName = element.getAttribute('data-testid').split('.')[1];

        if (!bbbMultiUserTools.includes(toolName)) {
          // eslint-disable-next-line no-param-reassign
          element.style.display = 'none';
        }
      });

      if (actionsElement) {
        if (!bbbMultiUserTools.includes('actions')) {
          actionsElement.style.display = 'none';
        }
      }
    }
  // TODO: we should add the dependency  list in [] parameter here
  // so this is not run on every render
  });

  React.useEffect(() => {
    const bbbPresenterTools = getFromUserSettings(
      'bbb_presenter_tools',
      meetingClientSettingsInitialValues.public.whiteboard.toolbar.presenterTools,
    );
    const allElements = document.querySelectorAll('[data-testid^="tools."]');
    const actionsElement = document.querySelector('[data-testid="main.action-menu"]');

    if (bbbPresenterTools.length >= 1 && isPresenter) {
      allElements.forEach((element) => {
        const toolName = element.getAttribute('data-testid').split('.')[1];

        if (!bbbPresenterTools.includes(toolName)) {
          // eslint-disable-next-line no-param-reassign
          element.style.display = 'none';
        }
      });

      if (actionsElement) {
        if (!bbbPresenterTools.includes('actions')) {
          actionsElement.style.display = 'none';
        }
      }
    }
  // TODO: we should add the dependency  list in [] parameter here
  // so this is not run on every render
  });

  React.useEffect(() => {
    const bbbMultiUserPenOnly = getFromUserSettings(
      'bbb_multi_user_pen_only',
      false,
    );
    const allElements = document.querySelectorAll('[data-testid^="tools."]');
    const actionsElement = document.querySelector('[data-testid="main.action-menu"]');

    if (bbbMultiUserPenOnly && !isModerator && !isPresenter) {
      allElements.forEach((element) => {
        const toolName = element.getAttribute('data-testid').split('.')[1];

        const displayStyle = toolName !== 'draw' ? 'none' : 'flex';
        // eslint-disable-next-line no-param-reassign
        element.style.display = displayStyle;
      });

      if (actionsElement) {
        actionsElement.style.display = 'none';
      }
    }
  // TODO: we should add the dependency  list in [] parameter here
  // so this is not run on every render
  });

  return (
    <div
      ref={whiteboardRef}
      id="whiteboard-element"
      key={`animations=-${animations}-${whiteboardToolbarAutoHide}-${language}-${presentationId}-${fitToWidth}`}
    >
      <Tldraw
        autoFocus={false}
        key={`tldrawv2-${presentationId}-${animations}`}
        forceMobile
        hideUi={!(hasWBAccessRef.current || isPresenter)}
        onMount={handleTldrawMount}
        tools={customTools}
      />
      <Styled.TldrawV2GlobalStyle
        {...{
          hasWBAccess: hasWBAccessRef.current,
          bgSelected: bgSelectedRef.current,
          isPresenter,
          isRTL,
          isMultiUserActive,
          isToolbarVisible,
          presentationHeight,
        }}
      />
    </div>
  );
});

export default Whiteboard;

Whiteboard.propTypes = {
  isPresenter: PropTypes.bool,
  isPhone: PropTypes.bool,
  removeShapes: PropTypes.func.isRequired,
  persistShapeWrapper: PropTypes.func.isRequired,
  notifyNotAllowedChange: PropTypes.func.isRequired,
  shapes: PropTypes.objectOf(PropTypes.shape).isRequired,
  assets: PropTypes.arrayOf(PropTypes.shape).isRequired,
  currentUser: PropTypes.shape({
    userId: PropTypes.string.isRequired,
  }),
  whiteboardId: PropTypes.string,
  zoomSlide: PropTypes.func.isRequired,
  curPageNum: PropTypes.number.isRequired,
  presentationWidth: PropTypes.number.isRequired,
  presentationHeight: PropTypes.number.isRequired,
  zoomChanger: PropTypes.func.isRequired,
  isRTL: PropTypes.bool.isRequired,
  fitToWidth: PropTypes.bool.isRequired,
  zoomValue: PropTypes.number.isRequired,
  intl: PropTypes.shape({
    formatMessage: PropTypes.func.isRequired,
  }).isRequired,
  colorStyle: PropTypes.string.isRequired,
  dashStyle: PropTypes.string.isRequired,
  fillStyle: PropTypes.string.isRequired,
  fontStyle: PropTypes.string.isRequired,
  sizeStyle: PropTypes.string.isRequired,
  presentationAreaHeight: PropTypes.number.isRequired,
  presentationAreaWidth: PropTypes.number.isRequired,
  maxNumberOfAnnotations: PropTypes.number.isRequired,
  darkTheme: PropTypes.bool.isRequired,
  setTldrawIsMounting: PropTypes.func.isRequired,
  presentationId: PropTypes.string,
  setTldrawAPI: PropTypes.func.isRequired,
  isMultiUserActive: PropTypes.bool,
  whiteboardToolbarAutoHide: PropTypes.bool,
  toggleToolsAnimations: PropTypes.func.isRequired,
  animations: PropTypes.bool,
  isToolbarVisible: PropTypes.bool,
  isModerator: PropTypes.bool,
  currentPresentationPage: PropTypes.shape(),
  hasWBAccess: PropTypes.bool,
  bgShape: PropTypes.arrayOf(PropTypes.shape).isRequired,
  publishCursorUpdate: PropTypes.func.isRequired,
  otherCursors: PropTypes.arrayOf(PropTypes.shape).isRequired,
  hideViewersCursor: PropTypes.bool,
  skipToSlide: PropTypes.func.isRequired,
  locale: PropTypes.string.isRequired,
  selectedLayout: PropTypes.string.isRequired,
  isInfiniteWhiteboard: PropTypes.bool,
  whiteboardWriters: PropTypes.arrayOf(PropTypes.shape).isRequired,
};
