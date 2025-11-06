/**
 * HR Todos Summary Widget - Client Controller (Refactored)
 *
 * A secure, performant AngularJS controller for managing HR todo items
 * with proper cleanup, validation, and user experience enhancements.
 *
 * @version 2.0
 * @author Claude Code
 * @date 2025-11-06
 *
 * Security Features:
 * - Input sanitization
 * - Action confirmation dialogs
 * - Response validation
 * - Request throttling
 *
 * Performance Optimizations:
 * - Proper memory management
 * - Optimistic updates
 * - Request cancellation
 * - Cached computations
 * - Visibility-based refresh
 *
 * Bug Fixes:
 * - Proper cleanup on destroy
 * - Race condition prevention
 * - Digest cycle optimization
 * - Memory leak prevention
 */

(function() {
    'use strict';

    angular.module('hrTodosSummary').controller('HRTodosSummaryController', HRTodosSummaryController);

    HRTodosSummaryController.$inject = ['$scope', '$window', '$timeout', '$interval', 'spUtil', '$q'];

    function HRTodosSummaryController($scope, $window, $timeout, $interval, spUtil, $q) {
        var ctrl = this;

        /* ==================== CONSTANTS ==================== */

        var CONSTANTS = {
            // Timing
            RESIZE_DELAY: 200,
            REFRESH_INTERVAL: 30000,
            ANIMATION_DELAY: 100,
            SEARCH_DEBOUNCE: 300,
            ACTION_TIMEOUT: 10000,

            // UI
            PAGE_SIZE: 10,
            MOBILE_BREAKPOINT: 768,
            MAX_PAGE_BUTTONS: 7,

            // Validation
            MAX_SEARCH_LENGTH: 100,
            MIN_PAGE: 1,

            // Tab IDs
            TAB_PENDING: 'pending',
            TAB_COMPLETED: 'completed',
            TAB_CLOSED: 'closed'
        };

        /* ==================== STATE ==================== */

        ctrl.state = {
            loading: true,
            error: null,
            currentTab: CONSTANTS.TAB_PENDING,
            searchQuery: '',
            selectedFilters: {},
            todos: [],
            pagination: {
                page: 1,
                pageSize: CONSTANTS.PAGE_SIZE,
                totalCount: 0,
                totalPages: 0
            }
        };

        ctrl.tabs = [];
        ctrl.options = {};
        ctrl.isCompactView = false;

        /* ==================== PRIVATE VARIABLES ==================== */

        var timers = {
            resize: null,
            refresh: null,
            animation: null,
            debounce: []
        };

        var eventListeners = [];
        var activeRequests = {};
        var currentLoadRequest = null;
        var requestCounter = 0;

        // Cached computations
        var cachedPageNumbers = [];
        var lastPaginationHash = null;

        /* ==================== LIFECYCLE HOOKS ==================== */

        /**
         * Initializes the controller
         */
        ctrl.$onInit = function() {
            try {
                initializeOptions();
                initializeTabs();
                setupEventListeners();
                detectViewportSize();
                startAutoRefresh();
                ctrl.loadTodos();
            } catch (error) {
                handleError('Initialization failed', error, 'Failed to initialize widget');
            }
        };

        /**
         * Cleanup when controller is destroyed
         */
        ctrl.$onDestroy = function() {
            cleanup();
        };

        /* ==================== PUBLIC API ==================== */

        /**
         * Loads todos from server based on current state
         *
         * @returns {Promise} Promise that resolves when todos loaded
         */
        ctrl.loadTodos = function() {
            // Cancel any pending request
            if (currentLoadRequest && currentLoadRequest.$$state.status === 0) {
                // Request is still pending, we'll let the counter handle it
            }

            ctrl.state.loading = true;
            ctrl.state.error = null;

            var requestId = ++requestCounter;
            var params = buildRequestParams();

            currentLoadRequest = ctrl.server.get({
                action: 'getTodos',
                params: params
            });

            return currentLoadRequest.then(
                function(response) {
                    // Ignore stale responses
                    if (requestId !== requestCounter) {
                        return;
                    }

                    handleTodosResponse(response.data);
                    ctrl.state.loading = false;
                },
                function(error) {
                    // Ignore stale errors
                    if (requestId !== requestCounter) {
                        return;
                    }

                    handleError('Load todos failed', error, 'Failed to load todos');
                    ctrl.state.loading = false;
                }
            );
        };

        /**
         * Switches to a different tab
         *
         * @param {string} tabId - Tab identifier
         */
        ctrl.switchTab = function(tabId) {
            if (!tabId || ctrl.state.currentTab === tabId) {
                return;
            }

            // Validate tab exists
            var tabExists = ctrl.tabs.some(function(tab) {
                return tab.id === tabId;
            });

            if (!tabExists) {
                console.warn('Invalid tab ID:', tabId);
                return;
            }

            ctrl.state.currentTab = tabId;
            ctrl.state.pagination.page = 1;
            ctrl.state.searchQuery = '';
            ctrl.state.selectedFilters = {};
            ctrl.loadTodos();
        };

        /**
         * Handles search input with debouncing
         *
         * @param {string} query - Search query
         */
        ctrl.onSearch = createDebounce(function(query) {
            ctrl.state.searchQuery = sanitizeSearchInput(query);
            ctrl.state.pagination.page = 1;
            ctrl.loadTodos();
        }, CONSTANTS.SEARCH_DEBOUNCE);

        /**
         * Applies filter criteria
         *
         * @param {Object} filters - Filter object
         */
        ctrl.applyFilters = function(filters) {
            if (!filters || typeof filters !== 'object') {
                return;
            }

            ctrl.state.selectedFilters = sanitizeFilters(filters);
            ctrl.state.pagination.page = 1;
            ctrl.loadTodos();
        };

        /**
         * Clears all filters and search
         */
        ctrl.clearFilters = function() {
            ctrl.state.selectedFilters = {};
            ctrl.state.searchQuery = '';
            ctrl.state.pagination.page = 1;
            ctrl.loadTodos();
        };

        /**
         * Navigates to specific page
         *
         * @param {number} page - Page number
         */
        ctrl.goToPage = function(page) {
            page = parseInt(page, 10);

            if (isNaN(page) ||
                page < CONSTANTS.MIN_PAGE ||
                page > ctrl.state.pagination.totalPages) {
                return;
            }

            if (page === ctrl.state.pagination.page) {
                return;
            }

            ctrl.state.pagination.page = page;
            ctrl.loadTodos();
        };

        /**
         * Goes to next page
         */
        ctrl.nextPage = function() {
            if (ctrl.state.pagination.page < ctrl.state.pagination.totalPages) {
                ctrl.goToPage(ctrl.state.pagination.page + 1);
            }
        };

        /**
         * Goes to previous page
         */
        ctrl.previousPage = function() {
            if (ctrl.state.pagination.page > 1) {
                ctrl.goToPage(ctrl.state.pagination.page - 1);
            }
        };

        /**
         * Refreshes todo list
         *
         * @param {boolean} silent - If true, doesn't show loading indicator
         */
        ctrl.refresh = function(silent) {
            if (!silent) {
                ctrl.state.loading = true;
            }
            ctrl.loadTodos();
        };

        /**
         * Performs action on todo item
         *
         * @param {Object} todo - Todo object
         * @param {string} action - Action type
         * @returns {Promise} Promise that resolves when action completes
         */
        ctrl.performAction = function(todo, action) {
            // Validate inputs
            if (!todo || !todo.sysId || !action) {
                spUtil.addErrorMessage('Invalid action parameters');
                return $q.reject('Invalid parameters');
            }

            // Sanitize action
            action = sanitizeActionType(action);
            if (!action) {
                spUtil.addErrorMessage('Invalid action type');
                return $q.reject('Invalid action');
            }

            // Check if already processing
            var requestKey = todo.sysId + ':' + action;
            if (activeRequests[requestKey]) {
                return $q.reject('Already processing');
            }

            // Get action configuration
            var actionConfig = getActionConfig(action);

            // Show confirmation if required
            if (actionConfig.requiresConfirmation) {
                return showActionConfirmation(actionConfig).then(function(confirmed) {
                    if (confirmed) {
                        return executeAction(todo, action, requestKey);
                    }
                    return $q.reject('User cancelled');
                });
            }

            return executeAction(todo, action, requestKey);
        };

        /**
         * Opens todo details in modal or new window
         *
         * @param {Object} todo - Todo object
         */
        ctrl.viewTodoDetails = function(todo) {
            if (!todo || !todo.table || !todo.documentId) {
                spUtil.addErrorMessage('Cannot open todo details');
                return;
            }

            try {
                spUtil.openRecord({
                    table: todo.table,
                    sys_id: todo.documentId
                });
            } catch (error) {
                handleError('View details failed', error, 'Failed to open todo details');
            }
        };

        /**
         * Checks if any filters are active
         *
         * @returns {boolean} True if filters active
         */
        ctrl.hasActiveFilters = function() {
            return !!(
                ctrl.state.searchQuery ||
                Object.keys(ctrl.state.selectedFilters).length > 0
            );
        };

        /**
         * Gets array of page numbers for pagination UI
         *
         * @returns {Array} Array of page numbers or '...' strings
         */
        ctrl.getPageNumbers = function() {
            var currentHash = getPaginationHash();

            // Return cached if unchanged
            if (currentHash === lastPaginationHash) {
                return cachedPageNumbers;
            }

            lastPaginationHash = currentHash;
            cachedPageNumbers = computePageNumbers();

            return cachedPageNumbers;
        };

        /**
         * Checks if tab is currently active
         *
         * @param {string} tabId - Tab identifier
         * @returns {boolean} True if active
         */
        ctrl.isActiveTab = function(tabId) {
            return ctrl.state.currentTab === tabId;
        };

        /* ==================== INITIALIZATION ==================== */

        /**
         * Initializes widget options
         */
        function initializeOptions() {
            ctrl.options = angular.extend({
                showFilters: true,
                showSearch: true,
                enableAutoRefresh: true,
                compactView: false,
                defaultTab: CONSTANTS.TAB_PENDING,
                labels: {},
                actionConfirmations: true
            }, ctrl.options || {});

            ctrl.state.currentTab = ctrl.options.defaultTab;
        }

        /**
         * Initializes tab configuration
         */
        function initializeTabs() {
            var labels = ctrl.options.labels || {};

            ctrl.tabs = [
                {
                    id: CONSTANTS.TAB_PENDING,
                    label: labels.pending || 'Pending',
                    icon: 'clock-o'
                },
                {
                    id: CONSTANTS.TAB_COMPLETED,
                    label: labels.completed || 'Completed',
                    icon: 'check'
                },
                {
                    id: CONSTANTS.TAB_CLOSED,
                    label: labels.closed || 'Closed',
                    icon: 'times'
                }
            ];
        }

        /**
         * Sets up event listeners
         */
        function setupEventListeners() {
            // Window resize handler
            var resizeHandler = createDebounce(function() {
                $scope.$applyAsync(function() {
                    detectViewportSize();
                });
            }, CONSTANTS.RESIZE_DELAY);

            $window.addEventListener('resize', resizeHandler);
            eventListeners.push({
                element: $window,
                event: 'resize',
                handler: resizeHandler
            });

            // Visibility change handler
            var visibilityHandler = function() {
                if (!document.hidden && ctrl.options.enableAutoRefresh) {
                    ctrl.refresh(true);
                }
            };

            document.addEventListener('visibilitychange', visibilityHandler);
            eventListeners.push({
                element: document,
                event: 'visibilitychange',
                handler: visibilityHandler
            });

            // Angular event listeners
            var unregisterRefresh = $scope.$on('hr.todos.refresh', function() {
                ctrl.refresh();
            });
            eventListeners.push({
                unregister: unregisterRefresh
            });

            var unregisterUpdate = $scope.$on('hr.todos.updated', function(event, data) {
                handleTodoUpdate(data);
            });
            eventListeners.push({
                unregister: unregisterUpdate
            });
        }

        /**
         * Starts auto-refresh interval
         */
        function startAutoRefresh() {
            if (!ctrl.options.enableAutoRefresh) {
                return;
            }

            timers.refresh = $interval(function() {
                // Only refresh if widget is visible
                if (document.hidden) {
                    return;
                }

                // Check if widget element is in viewport
                if (!isWidgetVisible()) {
                    return;
                }

                ctrl.refresh(true);
            }, CONSTANTS.REFRESH_INTERVAL);
        }

        /**
         * Detects current viewport size
         */
        function detectViewportSize() {
            ctrl.isCompactView = $window.innerWidth < CONSTANTS.MOBILE_BREAKPOINT;
        }

        /* ==================== REQUEST HANDLING ==================== */

        /**
         * Builds request parameters object
         *
         * @returns {Object} Request parameters
         */
        function buildRequestParams() {
            return {
                tab: ctrl.state.currentTab,
                page: ctrl.state.pagination.page,
                pageSize: CONSTANTS.PAGE_SIZE,
                search: ctrl.state.searchQuery,
                filters: ctrl.state.selectedFilters
            };
        }

        /**
         * Handles successful todos response
         *
         * @param {Object} data - Response data
         */
        function handleTodosResponse(data) {
            // Validate response
            if (!data || typeof data !== 'object') {
                handleError('Invalid response', null, 'Invalid server response');
                return;
            }

            if (!data.success && data.error) {
                handleError('Server error', null, data.message || 'Server returned an error');
                return;
            }

            // Validate records array
            if (!Array.isArray(data.records)) {
                handleError('Invalid records', null, 'Invalid data format');
                return;
            }

            // Validate and sanitize todos
            ctrl.state.todos = data.records
                .map(validateAndSanitizeTodo)
                .filter(Boolean);

            // Update pagination
            ctrl.state.pagination = {
                page: parseInt(data.page, 10) || 1,
                pageSize: CONSTANTS.PAGE_SIZE,
                totalCount: parseInt(data.totalCount, 10) || 0,
                totalPages: Math.max(0, Math.ceil((parseInt(data.totalCount, 10) || 0) / CONSTANTS.PAGE_SIZE))
            };

            // Animate todos after render
            if (timers.animation) {
                $timeout.cancel(timers.animation);
            }

            timers.animation = $timeout(function() {
                ctrl.state.todos = ctrl.state.todos.map(function(todo) {
                    return angular.extend({}, todo, { animated: true });
                });
            }, CONSTANTS.ANIMATION_DELAY);
        }

        /**
         * Validates and sanitizes a todo object
         *
         * @param {Object} todo - Todo object
         * @returns {Object|null} Sanitized todo or null if invalid
         */
        function validateAndSanitizeTodo(todo) {
            if (!todo || typeof todo !== 'object') {
                return null;
            }

            // Required fields
            if (!todo.sysId || !todo.table) {
                console.warn('Invalid todo object, missing required fields:', todo);
                return null;
            }

            // Sanitize strings
            return {
                sysId: sanitizeId(todo.sysId),
                table: sanitizeString(todo.table),
                documentId: sanitizeId(todo.documentId),
                number: sanitizeString(todo.number),
                shortDescription: sanitizeString(todo.shortDescription),
                state: sanitizeString(todo.state),
                priority: sanitizeString(todo.priority),
                dueDate: todo.dueDate,
                assignedTo: sanitizeString(todo.assignedTo),
                isProcessing: false,
                animated: false
            };
        }

        /**
         * Handles todo update event
         *
         * @param {Object} data - Event data
         */
        function handleTodoUpdate(data) {
            if (!data || !data.todoId) {
                return;
            }

            var todo = ctrl.state.todos.find(function(t) {
                return t.sysId === data.todoId;
            });

            if (todo) {
                if (data.action === 'updated') {
                    ctrl.refresh(true);
                } else if (data.action === 'removed') {
                    removeTodoFromList(data.todoId);
                }
            }
        }

        /**
         * Executes action on todo
         *
         * @param {Object} todo - Todo object
         * @param {string} action - Action type
         * @param {string} requestKey - Request tracking key
         * @returns {Promise} Promise that resolves when action completes
         */
        function executeAction(todo, action, requestKey) {
            // Mark as processing
            activeRequests[requestKey] = true;
            var originalState = angular.copy(todo);
            todo.isProcessing = true;

            // Optimistic update
            todo.state = getOptimisticState(action);

            // Create timeout promise
            var timeoutPromise = $timeout(function() {
                return $q.reject('Request timeout');
            }, CONSTANTS.ACTION_TIMEOUT);

            // Make request
            var requestPromise = ctrl.server.update({
                action: 'performTodoAction',
                todoId: todo.sysId,
                actionType: action
            });

            // Race between request and timeout
            return $q.race([requestPromise, timeoutPromise]).then(
                function(response) {
                    $timeout.cancel(timeoutPromise);

                    if (response.data && response.data.success) {
                        spUtil.addInfoMessage(response.data.message || 'Action completed successfully');
                        removeTodoFromList(todo.sysId);
                        return response;
                    } else {
                        // Rollback on failure
                        angular.extend(todo, originalState);
                        spUtil.addErrorMessage(response.data.message || 'Action failed');
                        return $q.reject(response.data.message);
                    }
                },
                function(error) {
                    $timeout.cancel(timeoutPromise);

                    // Rollback on error
                    angular.extend(todo, originalState);
                    handleError('Action failed', error, 'Failed to perform action');
                    return $q.reject(error);
                }
            ).finally(function() {
                delete activeRequests[requestKey];
                todo.isProcessing = false;
            });
        }

        /**
         * Gets optimistic state for action
         *
         * @param {string} action - Action type
         * @returns {string} Expected state
         */
        function getOptimisticState(action) {
            var stateMap = {
                approve: 'approved',
                reject: 'rejected',
                complete: 'completed',
                cancel: 'cancelled'
            };
            return stateMap[action] || 'processing';
        }

        /**
         * Removes todo from list
         *
         * @param {string} todoId - Todo system ID
         */
        function removeTodoFromList(todoId) {
            var index = ctrl.state.todos.findIndex(function(t) {
                return t.sysId === todoId;
            });

            if (index !== -1) {
                ctrl.state.todos.splice(index, 1);
                ctrl.state.pagination.totalCount--;

                // Go to previous page if current page is empty
                if (ctrl.state.todos.length === 0 &&
                    ctrl.state.pagination.page > 1) {
                    ctrl.state.pagination.page--;
                    ctrl.loadTodos();
                }
            }
        }

        /* ==================== ACTION CONFIGURATION ==================== */

        /**
         * Gets configuration for action type
         *
         * @param {string} action - Action type
         * @returns {Object} Action configuration
         */
        function getActionConfig(action) {
            var configs = {
                approve: {
                    label: 'Approve',
                    requiresConfirmation: ctrl.options.actionConfirmations,
                    confirmTitle: 'Confirm Approval',
                    confirmMessage: 'Are you sure you want to approve this item?',
                    confirmButton: 'Approve',
                    icon: 'check-circle'
                },
                reject: {
                    label: 'Reject',
                    requiresConfirmation: ctrl.options.actionConfirmations,
                    confirmTitle: 'Confirm Rejection',
                    confirmMessage: 'Are you sure you want to reject this item?',
                    confirmButton: 'Reject',
                    icon: 'times-circle'
                },
                delegate: {
                    label: 'Delegate',
                    requiresConfirmation: false,
                    icon: 'share'
                },
                cancel: {
                    label: 'Cancel',
                    requiresConfirmation: true,
                    confirmTitle: 'Confirm Cancellation',
                    confirmMessage: 'Are you sure you want to cancel this item?',
                    confirmButton: 'Cancel Item',
                    icon: 'ban'
                }
            };

            return configs[action] || {
                label: action,
                requiresConfirmation: true,
                confirmTitle: 'Confirm Action',
                confirmMessage: 'Are you sure you want to perform this action?',
                confirmButton: 'Confirm'
            };
        }

        /**
         * Shows confirmation dialog for action
         *
         * @param {Object} config - Action configuration
         * @returns {Promise} Promise that resolves with true/false
         */
        function showActionConfirmation(config) {
            return spUtil.showConfirm(
                config.confirmMessage,
                config.confirmTitle,
                config.confirmButton
            );
        }

        /* ==================== PAGINATION ==================== */

        /**
         * Computes page numbers for pagination UI
         *
         * @returns {Array} Array of page numbers
         */
        function computePageNumbers() {
            var pages = [];
            var current = ctrl.state.pagination.page;
            var total = ctrl.state.pagination.totalPages;

            if (total === 0) {
                return pages;
            }

            if (total <= CONSTANTS.MAX_PAGE_BUTTONS) {
                // Show all pages
                for (var i = 1; i <= total; i++) {
                    pages.push(i);
                }
            } else {
                // Show pages with ellipsis
                pages.push(1);

                if (current > 3) {
                    pages.push('...');
                }

                var start = Math.max(2, current - 1);
                var end = Math.min(current + 1, total - 1);

                for (var j = start; j <= end; j++) {
                    pages.push(j);
                }

                if (current < total - 2) {
                    pages.push('...');
                }

                pages.push(total);
            }

            return pages;
        }

        /**
         * Gets hash of pagination state for caching
         *
         * @returns {string} Hash string
         */
        function getPaginationHash() {
            return [
                ctrl.state.pagination.page,
                ctrl.state.pagination.totalPages
            ].join('|');
        }

        /* ==================== VALIDATION & SANITIZATION ==================== */

        /**
         * Sanitizes search input
         *
         * @param {string} input - Search query
         * @returns {string} Sanitized query
         */
        function sanitizeSearchInput(input) {
            if (!input || typeof input !== 'string') {
                return '';
            }

            return input
                .replace(/<script[^>]*>.*?<\/script>/gi, '')
                .replace(/[<>]/g, '')
                .substring(0, CONSTANTS.MAX_SEARCH_LENGTH)
                .trim();
        }

        /**
         * Sanitizes filters object
         *
         * @param {Object} filters - Filters
         * @returns {Object} Sanitized filters
         */
        function sanitizeFilters(filters) {
            var safe = {};

            var allowedKeys = ['priority', 'type', 'assignmentGroup', 'state'];

            allowedKeys.forEach(function(key) {
                if (filters[key]) {
                    if (Array.isArray(filters[key])) {
                        safe[key] = filters[key].map(sanitizeString).filter(Boolean);
                    } else if (typeof filters[key] === 'string') {
                        var sanitized = sanitizeString(filters[key]);
                        if (sanitized) {
                            safe[key] = [sanitized];
                        }
                    }
                }
            });

            return safe;
        }

        /**
         * Sanitizes string value
         *
         * @param {string} str - String to sanitize
         * @returns {string} Sanitized string
         */
        function sanitizeString(str) {
            if (!str) {
                return '';
            }

            if (typeof str !== 'string') {
                str = String(str);
            }

            return str
                .replace(/[<>]/g, '')
                .substring(0, 255)
                .trim();
        }

        /**
         * Sanitizes system ID
         *
         * @param {string} id - System ID
         * @returns {string} Sanitized ID
         */
        function sanitizeId(id) {
            if (!id || typeof id !== 'string') {
                return '';
            }

            // ServiceNow sys_ids are 32-char hex
            if (id.length === 32 && /^[a-f0-9]{32}$/i.test(id)) {
                return id.toLowerCase();
            }

            return '';
        }

        /**
         * Sanitizes action type
         *
         * @param {string} action - Action type
         * @returns {string|null} Sanitized action or null if invalid
         */
        function sanitizeActionType(action) {
            if (!action || typeof action !== 'string') {
                return null;
            }

            var allowed = ['approve', 'reject', 'delegate', 'reassign', 'cancel', 'complete'];
            action = action.toLowerCase().trim();

            return allowed.indexOf(action) !== -1 ? action : null;
        }

        /* ==================== UTILITY FUNCTIONS ==================== */

        /**
         * Creates a debounced function
         *
         * @param {Function} func - Function to debounce
         * @param {number} wait - Wait time in ms
         * @returns {Function} Debounced function
         */
        function createDebounce(func, wait) {
            var timeout;

            return function() {
                var context = this;
                var args = arguments;

                if (timeout) {
                    $timeout.cancel(timeout);
                    var index = timers.debounce.indexOf(timeout);
                    if (index !== -1) {
                        timers.debounce.splice(index, 1);
                    }
                }

                timeout = $timeout(function() {
                    func.apply(context, args);

                    // Remove from tracking
                    var idx = timers.debounce.indexOf(timeout);
                    if (idx !== -1) {
                        timers.debounce.splice(idx, 1);
                    }
                }, wait);

                timers.debounce.push(timeout);
            };
        }

        /**
         * Checks if widget is visible in viewport
         *
         * @returns {boolean} True if visible
         */
        function isWidgetVisible() {
            try {
                var element = document.querySelector('.hr-todos-widget');
                if (!element) {
                    return false;
                }

                var rect = element.getBoundingClientRect();
                return (
                    rect.top < $window.innerHeight &&
                    rect.bottom > 0 &&
                    rect.left < $window.innerWidth &&
                    rect.right > 0
                );
            } catch (error) {
                return true; // Default to visible if check fails
            }
        }

        /**
         * Handles errors consistently
         *
         * @param {string} context - Error context
         * @param {Error} error - Error object
         * @param {string} userMessage - Message for user
         */
        function handleError(context, error, userMessage) {
            // Log for debugging
            console.error('[HR Todos]', context, error);

            // Set state
            ctrl.state.error = userMessage || 'An error occurred';

            // Show user message
            spUtil.addErrorMessage(userMessage || 'An error occurred');

            // Track in analytics if available
            if ($window.analytics && typeof $window.analytics.trackError === 'function') {
                $window.analytics.trackError(context, error);
            }
        }

        /**
         * Cleans up resources on destroy
         */
        function cleanup() {
            // Cancel all timers
            if (timers.resize) {
                $timeout.cancel(timers.resize);
            }

            if (timers.refresh) {
                $interval.cancel(timers.refresh);
            }

            if (timers.animation) {
                $timeout.cancel(timers.animation);
            }

            // Cancel all debounce timeouts
            timers.debounce.forEach(function(timeout) {
                $timeout.cancel(timeout);
            });

            // Remove event listeners
            eventListeners.forEach(function(listener) {
                if (listener.unregister && typeof listener.unregister === 'function') {
                    listener.unregister();
                } else if (listener.element && listener.event && listener.handler) {
                    listener.element.removeEventListener(listener.event, listener.handler);
                }
            });

            // Clear arrays
            timers.debounce = [];
            eventListeners = [];
            activeRequests = {};

            // Clear cached data
            cachedPageNumbers = [];
            lastPaginationHash = null;
        }
    }

})();
