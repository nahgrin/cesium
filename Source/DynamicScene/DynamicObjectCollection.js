/*global define*/
define(['../Core/defined',
        '../Core/defineProperties',
        '../Core/Event',
        '../Core/TimeInterval',
        '../Core/Iso8601',
        '../Core/DeveloperError',
        './DynamicObject'
    ], function(
        defined,
        defineProperties,
        Event,
        TimeInterval,
        Iso8601,
        DeveloperError,
        DynamicObject) {
    "use strict";

    function fireChangedEvent(collection) {
        if (collection._suspectRefCount === 0) {
            var added = collection._added;
            var removed = collection._removed;
            if (added.length !== 0 || removed.length !== 0) {
                collection._collectionChanged.raiseEvent(collection, added, removed);
                added.length = 0;
                removed.length = 0;
            }
        }
    }

    /**
     * An observable collection of {@link DynamicObject} instances where each object has a unique id.
     * @alias DynamicObjectCollection
     * @constructor
     */
    var DynamicObjectCollection = function() {
        this._added = [];
        this._array = [];
        this._collectionChanged = new Event();
        this._removed = [];
        this._hash = {};
        this._suspectRefCount = 0;
    };

    /**
     * Prevents {@link DynamicObjectCollection#collectionChanged} events from being raised
     * until a corresponding call is made to {@link DynamicObjectCollection#resumeEvents}, at which
     * point a single event will be raised that covers all suspended operations.
     * This allows for many items to be added and removed efficiently.
     * This function is reference counted and can safely be called multiple times as long as there
     * are corresponding calls to {@link DynamicObjectCollection#resumeEvents}.
     * @memberof DynamicObjectCollection
     */
    DynamicObjectCollection.prototype.suspendEvents = function() {
        this._suspectRefCount++;
    };

    /**
     * Resumes raising {@link DynamicObjectCollection#collectionChanged} events immediately
     * when an item is added or removed.  Any modifications made while while events were suspended
     * will be triggered as a single event when this function is called.
     * This function is reference counted and can safely be called multiple times as long as there
     * are corresponding calls to {@link DynamicObjectCollection#resumeEvents}.
     * @memberof DynamicObjectCollection
     *
     * @exception {DeveloperError} resumeEvents can not be called before suspendEvents.
     */
    DynamicObjectCollection.prototype.resumeEvents = function() {
        if (this._suspectRefCount === 0) {
            throw new DeveloperError('resumeEvents can not be called before suspendEvents.');
        }

        this._suspectRefCount--;
        fireChangedEvent(this);
    };

    /**
     * The signature of the event genereated by {@link DynamicObjectCollection#collectionChanged}.
     * @memberof DynamicObjectCollection
     * @function
     *
     * @param {DynamicObjectCollection} collection The collection that triggered the event.
     * @param {Array} added The array of {@link DynamicObject} instances that have been added to the collection.
     * @param {Array} removed The array of {@link DynamicObject} instances that have been removed from the collection.
     */
    DynamicObjectCollection.collectionChangedEventCallback = undefined;

    defineProperties(DynamicObjectCollection.prototype, {
        /**
         * Gets the event that is fired when objects are added or removed from the collection.
         * The generated event is a {@link DynamicObjectCollection.collectionChangedEventCallback}.
         * @memberof DynamicObjectCollection.prototype
         *
         * @type {Event}
         */
        collectionChanged : {
            get : function() {
                return this._collectionChanged;
            }
        }
    });

    /**
     * Computes the maximum availability of the DynamicObjects in the collection.
     * If the collection contains a mix of infinitely available data and non-infinite data,
     * it will return the interval pertaining to the non-infinite data only.  If all
     * data is infinite, an infinite interval will be returned.
     * @memberof DynamicObjectCollection
     *
     * @returns {TimeInterval} The availability of DynamicObjects in the collection.
     */
    DynamicObjectCollection.prototype.computeAvailability = function() {
        var startTime = Iso8601.MAXIMUM_VALUE;
        var stopTime = Iso8601.MINIMUM_VALUE;
        var dynamicObjects = this._array;
        for ( var i = 0, len = dynamicObjects.length; i < len; i++) {
            var object = dynamicObjects[i];
            var availability = object.availability;
            if (defined(availability)) {
                var start = availability.start;
                var stop = availability.stop;
                if (start.lessThan(startTime) && !start.equals(Iso8601.MINIMUM_VALUE)) {
                    startTime = object.availability.start;
                }
                if (stop.greaterThan(stopTime) && !stop.equals(Iso8601.MAXIMUM_VALUE)) {
                    stopTime = object.availability.stop;
                }
            }
        }

        if (Iso8601.MAXIMUM_VALUE.equals(startTime)) {
            startTime = Iso8601.MINIMUM_VALUE;
        }
        if (Iso8601.MINIMUM_VALUE.equals(stopTime)) {
            stopTime = Iso8601.MAXIMUM_VALUE;
        }
        return new TimeInterval(startTime, stopTime, true, true);
    };

    /**
     * Add an object to the collection.
     * @memberof DynamicObjectCollection
     *
     * @param {DynamicObject} dynamicObject The object to be added.
     * @exception {DeveloperError} dynamicObject is required.
     * @exception {DeveloperError} An object with <dynamicObject.id> already exists in this collection.
     */
    DynamicObjectCollection.prototype.add = function(dynamicObject) {
        if (!defined(dynamicObject)) {
            throw new DeveloperError('dynamicObject is required.');
        }
        var id = dynamicObject.id;
        var hash = this._hash;
        if (defined(hash[id])) {
            throw new DeveloperError('An object with id ' + id + ' already exists in this collection.');
        }

        hash[id] = dynamicObject;
        this._array.push(dynamicObject);

        var removed = this._removed;
        var index = removed.indexOf(dynamicObject);
        if (index !== -1) {
            removed.splice(index, 1);
        } else {
            this._added.push(dynamicObject);
        }
        fireChangedEvent(this);
    };

    /**
     * Removes an object from the collection.
     * @memberof DynamicObjectCollection
     *
     * @param {DynamicObject} dynamicObject The object to be added.
     * @returns {Boolean} true if the item was removed, false if it did not exist in the collection.
     *
     * @exception {DeveloperError} dynamicObject is required.
     */
    DynamicObjectCollection.prototype.remove = function(dynamicObject) {
        if (!defined(dynamicObject)) {
            throw new DeveloperError('dynamicObject is required');
        }
        return this.removeById(dynamicObject.id);
    };

    /**
     * Removes an object with the provided id from the collection.
     * @memberof DynamicObjectCollection
     *
     * @param {Object} id The id of the object to remove.
     * @returns {Boolean} true if the item was removed, false if no item with the provided id existed in the collection.
     *
     * @exception {DeveloperError} id is required.
     */
    DynamicObjectCollection.prototype.removeById = function(id) {
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        var hash = this._hash;
        var array = this._array;
        var dynamicObject = hash[id];
        var result = defined(dynamicObject);
        if (result) {
            hash[id] = undefined;
            array.splice(array.indexOf(dynamicObject), 1);

            var added = this._added;
            var index = added.indexOf(dynamicObject);
            if (index !== -1) {
                added.splice(index, 1);
            } else {
                this._removed.push(dynamicObject);
            }
            fireChangedEvent(this);
        }
        return result;
    };

    /**
     * Removes all objects from the collection.
     * @memberof DynamicObjectCollection
     */
    DynamicObjectCollection.prototype.removeAll = function() {
        var removed = this._removed;
        var added = this._added;
        var array = this._array;
        var arrayLength = array.length;

        //The remove event should only contain items added before events were suspended
        for ( var i = 0; i < arrayLength; i++) {
            var existingItem = array[i];
            if (added.indexOf(existingItem) === -1) {
                removed.push(existingItem);
            }
        }

        added.length = 0;
        array.length = 0;
        this._hash = {};

        fireChangedEvent(this);
    };

    /**
     * Gets an object with the specified id.
     * @memberof DynamicObjectCollection
     *
     * @param {Object} id The id of the object to retrieve.
     * @returns {DynamicObject} The object with the provided id or undefined if the id did not exist in the collection.
     *
     * @exception {DeveloperError} id is required.
     */
    DynamicObjectCollection.prototype.getById = function(id) {
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        return this._hash[id];
    };

    /**
     * Gets the array of DynamicObject instances in the collection.
     * The array should not be modified directly.
     * @memberof DynamicObjectCollection
     *
     * @returns {Array} the array of DynamicObject instances in the collection.
     */
    DynamicObjectCollection.prototype.getObjects = function() {
        return this._array;
    };

    /**
     * Gets an object with the specified id or creates it and adds it to the collection if it does not exist.
     * @memberof DynamicObjectCollection
     *
     * @param {Object} id The id of the object to retrieve or create.
     * @returns {DynamicObject} The new or existing object.
     *
     * @exception {DeveloperError} id is required.
     */
    DynamicObjectCollection.prototype.getOrCreateObject = function(id) {
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        var dynamicObject = this._hash[id];
        if (!defined(dynamicObject)) {
            dynamicObject = new DynamicObject(id);
            this.add(dynamicObject);
        }
        return dynamicObject;
    };

    return DynamicObjectCollection;
});
