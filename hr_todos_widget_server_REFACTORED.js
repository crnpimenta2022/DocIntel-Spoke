/**
 * HR Todos Summary Widget - Server Script (Refactored)
 *
 * Provides a secure, performant interface for managing HR todo items
 * with pagination, filtering, and action capabilities.
 *
 * @version 2.0
 * @author Claude Code
 * @date 2025-11-06
 *
 * Security Features:
 * - Input validation and sanitization
 * - Action type whitelisting
 * - Ownership verification
 * - Query injection prevention
 *
 * Performance Optimizations:
 * - Query result limits
 * - Table label caching
 * - Efficient filter processing
 */

(function() {
    'use strict';

    /* ==================== CONSTANTS ==================== */

    var CONSTANTS = {
        // Action types
        ALLOWED_ACTIONS: ['approve', 'reject', 'delegate', 'reassign', 'cancel'],

        // Pagination
        DEFAULT_PAGE_SIZE: 10,
        MIN_PAGE: 1,
        MAX_PAGE: 10000,

        // Limits
        MAX_STRING_LENGTH: 255,
        MAX_SEARCH_LENGTH: 100,
        MAX_FILTER_ITEMS: 50,
        MAX_QUERY_LIMIT: 1000,

        // Sort options
        ALLOWED_SORT_FIELDS: ['sys_created_on', 'priority', 'due_date', 'state'],
        ALLOWED_SORT_ORDERS: ['asc', 'desc'],

        // Tab types
        VALID_TABS: ['pending', 'completed', 'closed', 'all'],

        // Priority labels
        PRIORITY_LABELS: {
            '1': 'Critical',
            '2': 'High',
            '3': 'Moderate',
            '4': 'Low',
            '5': 'Planning'
        },

        // System properties
        PROPS: {
            ENABLE_DELEGATION: 'hr.todos.enable_delegation',
            SHOW_PRIORITY: 'hr.todos.show_priority',
            PAGE_SIZE: 'hr.todos.page_size'
        },

        // Event names
        EVENTS: {
            TODO_UPDATED: 'hr.todos.updated',
            TODO_ERROR: 'hr.todos.error'
        }
    };

    /* ==================== DATA API ROUTER ==================== */

    try {
        _routeRequest();
    } catch (e) {
        _logError('Fatal error in widget initialization', e);
        data.response = _createErrorResponse('System initialization failed');
    }

    /* ==================== PRIVATE FUNCTIONS ==================== */

    /**
     * Routes incoming API requests to appropriate handlers
     */
    function _routeRequest() {
        // Handle API calls
        if (input && input.action) {
            switch (input.action) {
                case 'getTodos':
                    data.response = _getTodos(input.params || {});
                    return;

                case 'performTodoAction':
                    data.response = _performTodoAction(input.todoId, input.actionType);
                    return;

                case 'getFilters':
                    data.response = _getFilters(input.tab || 'pending');
                    return;

                default:
                    data.response = _createErrorResponse('Unknown action: ' + input.action);
                    return;
            }
        }

        // Initialize widget data for initial load
        _initializeWidget();
    }

    /**
     * Initializes widget configuration and user data
     */
    function _initializeWidget() {
        data.user = gs.getUserID();
        data.userName = gs.getUserDisplayName();
        data.canDelegate = _checkDelegationPermission();

        data.config = {
            enableDelegation: gs.getProperty(CONSTANTS.PROPS.ENABLE_DELEGATION, 'false') === 'true',
            showPriority: gs.getProperty(CONSTANTS.PROPS.SHOW_PRIORITY, 'true') === 'true',
            pageSize: parseInt(gs.getProperty(CONSTANTS.PROPS.PAGE_SIZE, CONSTANTS.DEFAULT_PAGE_SIZE), 10) || CONSTANTS.DEFAULT_PAGE_SIZE
        };

        // Ensure pageSize is reasonable
        data.config.pageSize = Math.min(Math.max(data.config.pageSize, 5), 100);
    }

    /**
     * Retrieves todos for the current user with pagination and filtering
     *
     * @param {Object} params - Query parameters
     * @param {string} params.tab - Tab name (pending/completed/closed/all)
     * @param {number} params.page - Page number (1-indexed)
     * @param {string} params.search - Search term
     * @param {Object} params.filters - Filter criteria
     * @param {string} params.sortBy - Sort field name
     * @param {string} params.sortOrder - Sort order (asc/desc)
     * @returns {Object} Response with records, count, and pagination info
     */
    function _getTodos(params) {
        try {
            // Validate and sanitize all input parameters
            var validatedParams = _validateParams(params);

            if (!validatedParams.valid) {
                return _createErrorResponse(validatedParams.error, {
                    records: [],
                    totalCount: 0
                });
            }

            var safeParams = validatedParams.params;

            // Delegate to utility class for business logic
            var todoUtils = new TodoPageUtils();
            var result = todoUtils.getTodos(safeParams);

            return {
                success: true,
                records: result.records || [],
                totalCount: result.totalCount || 0,
                page: safeParams.page,
                pageSize: safeParams.pageSize,
                hasMore: result.hasMore || false,
                timestamp: new GlideDateTime().getNumericValue()
            };

        } catch (e) {
            _logError('Error in getTodos', e, params);
            return _createErrorResponse('Failed to load todos', {
                records: [],
                totalCount: 0,
                page: 1,
                pageSize: CONSTANTS.DEFAULT_PAGE_SIZE
            });
        }
    }

    /**
     * Performs an action on a todo item (approve, reject, delegate, etc.)
     *
     * @param {string} todoId - System ID of the todo item
     * @param {string} actionType - Type of action to perform
     * @returns {Object} Response indicating success/failure with message
     */
    function _performTodoAction(todoId, actionType) {
        try {
            // Validate action inputs
            var validation = _validateTodoAction(todoId, actionType);
            if (!validation.valid) {
                _logWarning('Invalid todo action attempt', {
                    todoId: todoId,
                    actionType: actionType,
                    error: validation.error,
                    user: gs.getUserID()
                });
                return _createErrorResponse(validation.error);
            }

            // Verify user has permission to act on this todo
            var ownershipCheck = _validateTodoOwnership(todoId);
            if (!ownershipCheck.valid) {
                _logWarning('Unauthorized todo action attempt', {
                    todoId: todoId,
                    actionType: actionType,
                    user: gs.getUserID()
                });
                return _createErrorResponse('You do not have permission to perform this action');
            }

            // Special handling for delegation
            if (actionType === 'delegate' && !data.canDelegate) {
                return _createErrorResponse('You do not have delegation permissions');
            }

            // Perform the action
            var todoUtils = new TodoPageUtils();
            var result = todoUtils.performAction(todoId, actionType);

            // Log success and trigger events
            if (result && result.success) {
                _logInfo('Todo action performed successfully', {
                    todoId: todoId,
                    actionType: actionType,
                    user: gs.getUserID()
                });

                // Queue event for any listeners
                gs.eventQueue(
                    CONSTANTS.EVENTS.TODO_UPDATED,
                    null,  // Current object (none)
                    gs.getUserID(),
                    todoId,
                    actionType
                );
            }

            return result || _createErrorResponse('Action completed but returned no result');

        } catch (e) {
            _logError('Error in performTodoAction', e, {
                todoId: todoId,
                actionType: actionType
            });

            // Queue error event
            gs.eventQueue(
                CONSTANTS.EVENTS.TODO_ERROR,
                null,
                gs.getUserID(),
                todoId,
                actionType,
                e.message
            );

            return _createErrorResponse('Failed to perform action. Please try again.');
        }
    }

    /**
     * Retrieves available filter options for a given tab
     *
     * @param {string} tab - Tab name to get filters for
     * @returns {Object} Response with available filter options
     */
    function _getFilters(tab) {
        try {
            // Validate tab parameter
            tab = _sanitizeString(tab) || 'pending';
            if (CONSTANTS.VALID_TABS.indexOf(tab) === -1) {
                tab = 'pending';
            }

            var filters = {
                priorities: [],
                types: [],
                assignmentGroups: []
            };

            // Query for user's todos to build filter options
            var gr = new GlideRecord('sysapproval_approver');
            gr.addQuery('approver', gs.getUserID());
            gr.addActiveQuery();

            // Apply tab-specific filters
            _applyTabFilter(gr, tab);

            // Limit results for performance
            gr.setLimit(CONSTANTS.MAX_QUERY_LIMIT);
            gr.orderBy('priority');
            gr.query();

            // Use Sets to avoid duplicates
            var prioritySet = {};
            var typeSet = {};
            var groupSet = {};

            // Cache for table labels to avoid N+1 queries
            var tableLabelCache = {};

            while (gr.next()) {
                // Collect priorities
                if (!gs.nil(gr.priority)) {
                    var priority = gr.priority.toString();
                    if (!prioritySet[priority]) {
                        prioritySet[priority] = {
                            value: priority,
                            label: _getPriorityLabel(priority)
                        };
                    }
                }

                // Collect types (source tables)
                if (!gs.nil(gr.source_table)) {
                    var table = gr.source_table.toString();
                    if (!typeSet[table]) {
                        // Use cache for table labels
                        if (!tableLabelCache[table]) {
                            tableLabelCache[table] = _getTableLabel(table);
                        }

                        typeSet[table] = {
                            value: table,
                            label: tableLabelCache[table]
                        };
                    }
                }

                // Collect assignment groups if available
                if (!gs.nil(gr.assignment_group)) {
                    var groupId = gr.assignment_group.toString();
                    if (!groupSet[groupId]) {
                        groupSet[groupId] = {
                            value: groupId,
                            label: gr.assignment_group.getDisplayValue()
                        };
                    }
                }
            }

            // Convert Sets to arrays
            filters.priorities = _objectToSortedArray(prioritySet);
            filters.types = _objectToSortedArray(typeSet);
            filters.assignmentGroups = _objectToSortedArray(groupSet);

            return {
                success: true,
                filters: filters,
                tab: tab
            };

        } catch (e) {
            _logError('Error in getFilters', e, { tab: tab });
            return _createErrorResponse('Failed to load filters', {
                filters: {
                    priorities: [],
                    types: [],
                    assignmentGroups: []
                }
            });
        }
    }

    /* ==================== VALIDATION FUNCTIONS ==================== */

    /**
     * Validates and sanitizes request parameters
     *
     * @param {Object} params - Raw input parameters
     * @returns {Object} Validation result with sanitized params
     */
    function _validateParams(params) {
        try {
            params = params || {};

            // Validate tab
            var tab = _sanitizeString(params.tab) || 'pending';
            if (CONSTANTS.VALID_TABS.indexOf(tab) === -1) {
                return {
                    valid: false,
                    error: 'Invalid tab: ' + tab
                };
            }

            // Validate page number
            var page = parseInt(params.page, 10) || CONSTANTS.MIN_PAGE;
            if (isNaN(page) || page < CONSTANTS.MIN_PAGE || page > CONSTANTS.MAX_PAGE) {
                page = CONSTANTS.MIN_PAGE;
            }

            // Validate page size
            var pageSize = parseInt(params.pageSize, 10) || CONSTANTS.DEFAULT_PAGE_SIZE;
            pageSize = Math.min(Math.max(pageSize, 5), 100);

            // Validate search term
            var search = _sanitizeString(params.search || '');
            if (search.length > CONSTANTS.MAX_SEARCH_LENGTH) {
                search = search.substring(0, CONSTANTS.MAX_SEARCH_LENGTH);
            }

            // Validate filters
            var filters = _validateFilters(params.filters);

            // Validate sort field
            var sortBy = _sanitizeString(params.sortBy) || 'sys_created_on';
            if (CONSTANTS.ALLOWED_SORT_FIELDS.indexOf(sortBy) === -1) {
                sortBy = 'sys_created_on';
            }

            // Validate sort order
            var sortOrder = _sanitizeString(params.sortOrder) || 'desc';
            if (CONSTANTS.ALLOWED_SORT_ORDERS.indexOf(sortOrder) === -1) {
                sortOrder = 'desc';
            }

            return {
                valid: true,
                params: {
                    tab: tab,
                    page: page,
                    pageSize: pageSize,
                    search: search,
                    filters: filters,
                    sortBy: sortBy,
                    sortOrder: sortOrder
                }
            };

        } catch (e) {
            _logError('Error validating parameters', e, params);
            return {
                valid: false,
                error: 'Invalid request parameters'
            };
        }
    }

    /**
     * Validates filter object structure and values
     *
     * @param {Object} filters - Raw filter object
     * @returns {Object} Sanitized filter object
     */
    function _validateFilters(filters) {
        var safeFilters = {};

        if (!filters || typeof filters !== 'object') {
            return safeFilters;
        }

        var allowedFilterKeys = ['priority', 'type', 'assignmentGroup', 'state'];

        allowedFilterKeys.forEach(function(key) {
            if (filters[key]) {
                if (Array.isArray(filters[key])) {
                    // Limit array size and sanitize each value
                    safeFilters[key] = filters[key]
                        .slice(0, CONSTANTS.MAX_FILTER_ITEMS)
                        .map(function(val) {
                            return _sanitizeString(val);
                        })
                        .filter(function(val) {
                            return val.length > 0;
                        });
                } else if (typeof filters[key] === 'string') {
                    // Single value filter
                    var sanitized = _sanitizeString(filters[key]);
                    if (sanitized.length > 0) {
                        safeFilters[key] = [sanitized];
                    }
                }
            }
        });

        return safeFilters;
    }

    /**
     * Validates todo action request
     *
     * @param {string} todoId - Todo system ID
     * @param {string} actionType - Action type
     * @returns {Object} Validation result
     */
    function _validateTodoAction(todoId, actionType) {
        // Validate todo ID
        if (!todoId || typeof todoId !== 'string' || todoId.length !== 32) {
            return {
                valid: false,
                error: 'Invalid todo ID format'
            };
        }

        // Check for potential injection attempts
        if (!/^[a-f0-9]{32}$/i.test(todoId)) {
            return {
                valid: false,
                error: 'Invalid todo ID characters'
            };
        }

        // Validate action type
        if (!actionType || typeof actionType !== 'string') {
            return {
                valid: false,
                error: 'Invalid action type'
            };
        }

        // Check against whitelist
        if (CONSTANTS.ALLOWED_ACTIONS.indexOf(actionType.toLowerCase()) === -1) {
            return {
                valid: false,
                error: 'Action type not allowed: ' + actionType
            };
        }

        return {
            valid: true
        };
    }

    /**
     * Validates that current user owns the specified todo
     *
     * @param {string} todoId - Todo system ID
     * @returns {Object} Validation result with optional todo record
     */
    function _validateTodoOwnership(todoId) {
        try {
            var gr = new GlideRecord('sysapproval_approver');

            // Use get() for single record retrieval
            if (gr.get(todoId)) {
                var isOwner = gr.getValue('approver') === gs.getUserID();

                // Check if user has admin override
                var hasAdminOverride = gs.hasRole('approval_admin');

                if (isOwner || hasAdminOverride) {
                    return {
                        valid: true,
                        record: gr,
                        isOwner: isOwner,
                        hasAdminOverride: hasAdminOverride
                    };
                }

                return {
                    valid: false,
                    error: 'Not the owner of this todo'
                };
            }

            return {
                valid: false,
                error: 'Todo not found'
            };

        } catch (e) {
            _logError('Error validating todo ownership', e, { todoId: todoId });
            return {
                valid: false,
                error: 'Unable to verify ownership'
            };
        }
    }

    /* ==================== HELPER FUNCTIONS ==================== */

    /**
     * Checks if current user has delegation permission
     *
     * @returns {boolean} True if user can delegate
     */
    function _checkDelegationPermission() {
        // Check if delegation is globally enabled
        if (gs.getProperty(CONSTANTS.PROPS.ENABLE_DELEGATION, 'false') !== 'true') {
            return false;
        }

        // Check user roles
        return gs.hasRole('approval_admin') ||
               gs.hasRole('approval_coordinator') ||
               gs.hasRole('approval_delegate');
    }

    /**
     * Applies tab-specific query filters
     *
     * @param {GlideRecord} gr - GlideRecord to filter
     * @param {string} tab - Tab name
     */
    function _applyTabFilter(gr, tab) {
        switch (tab) {
            case 'pending':
                gr.addQuery('state', 'requested');
                break;

            case 'completed':
                gr.addQuery('state', 'approved');
                break;

            case 'closed':
                gr.addQuery('state', 'IN', 'rejected,cancelled');
                break;

            case 'all':
                // No additional filter
                break;

            default:
                gr.addQuery('state', 'requested');
        }
    }

    /**
     * Sanitizes string input to prevent XSS and injection
     *
     * @param {*} str - Input to sanitize
     * @returns {string} Sanitized string
     */
    function _sanitizeString(str) {
        if (!str) {
            return '';
        }

        if (typeof str !== 'string') {
            str = String(str);
        }

        // Truncate to max length
        if (str.length > CONSTANTS.MAX_STRING_LENGTH) {
            str = str.substring(0, CONSTANTS.MAX_STRING_LENGTH);
        }

        // Escape HTML entities
        str = GlideStringUtil.escapeHTML(str);

        // Remove any control characters
        str = str.replace(/[\x00-\x1F\x7F]/g, '');

        return str.trim();
    }

    /**
     * Gets human-readable priority label
     *
     * @param {string} priority - Priority value
     * @returns {string} Priority label
     */
    function _getPriorityLabel(priority) {
        return CONSTANTS.PRIORITY_LABELS[priority] || 'Unknown (P' + priority + ')';
    }

    /**
     * Gets table display label with caching
     *
     * @param {string} tableName - Table name
     * @returns {string} Table display label
     */
    function _getTableLabel(tableName) {
        try {
            // Try to get from table metadata
            var tableUtil = new TableUtils(tableName);
            var label = tableUtil.getLabel();

            if (label && label !== tableName) {
                return label;
            }

            // Fallback to direct query
            var tableGr = new GlideRecord('sys_db_object');
            if (tableGr.get('name', tableName)) {
                return tableGr.getDisplayValue('label');
            }

            // Return formatted table name as last resort
            return _formatTableName(tableName);

        } catch (e) {
            return _formatTableName(tableName);
        }
    }

    /**
     * Formats table name for display
     *
     * @param {string} tableName - Table name
     * @returns {string} Formatted name
     */
    function _formatTableName(tableName) {
        if (!tableName) {
            return 'Unknown';
        }

        // Convert snake_case to Title Case
        return tableName
            .split('_')
            .map(function(word) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(' ');
    }

    /**
     * Converts object to sorted array by label
     *
     * @param {Object} obj - Object with value/label pairs
     * @returns {Array} Sorted array
     */
    function _objectToSortedArray(obj) {
        return Object.keys(obj)
            .map(function(key) {
                return obj[key];
            })
            .sort(function(a, b) {
                return (a.label || '').localeCompare(b.label || '');
            });
    }

    /**
     * Creates standardized error response
     *
     * @param {string} message - Error message
     * @param {Object} additionalData - Additional response data
     * @returns {Object} Error response object
     */
    function _createErrorResponse(message, additionalData) {
        var response = {
            success: false,
            error: true,
            message: message || 'An error occurred',
            timestamp: new GlideDateTime().getNumericValue()
        };

        // Merge additional data
        if (additionalData && typeof additionalData === 'object') {
            for (var key in additionalData) {
                if (additionalData.hasOwnProperty(key)) {
                    response[key] = additionalData[key];
                }
            }
        }

        return response;
    }

    /* ==================== LOGGING FUNCTIONS ==================== */

    /**
     * Logs error with structured data
     *
     * @param {string} message - Error message
     * @param {Error} error - Error object
     * @param {Object} context - Additional context
     */
    function _logError(message, error, context) {
        var logMessage = '[HR Todos Widget] ' + message;

        if (error) {
            logMessage += '\nError: ' + error.message;
            if (error.stack) {
                logMessage += '\nStack: ' + error.stack;
            }
        }

        if (context) {
            logMessage += '\nContext: ' + JSON.stringify(context);
        }

        logMessage += '\nUser: ' + gs.getUserID() + ' (' + gs.getUserName() + ')';

        gs.error(logMessage);
    }

    /**
     * Logs warning with structured data
     *
     * @param {string} message - Warning message
     * @param {Object} context - Additional context
     */
    function _logWarning(message, context) {
        var logMessage = '[HR Todos Widget] ' + message;

        if (context) {
            logMessage += '\nContext: ' + JSON.stringify(context);
        }

        gs.warn(logMessage);
    }

    /**
     * Logs info with structured data
     *
     * @param {string} message - Info message
     * @param {Object} context - Additional context
     */
    function _logInfo(message, context) {
        var logMessage = '[HR Todos Widget] ' + message;

        if (context) {
            logMessage += '\nContext: ' + JSON.stringify(context);
        }

        gs.info(logMessage);
    }

})();
