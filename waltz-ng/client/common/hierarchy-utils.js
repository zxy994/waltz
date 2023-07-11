/*
 * Waltz - Enterprise Architecture
 * Copyright (C) 2016, 2017, 2018, 2019 Waltz open source project
 * See README.md for more information
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific
 *
 */
import _ from "lodash";


/**
 *  Given a set of nodes with id and parentId constructs a 'searchStr' property for each
 *  node which is the concatenation of a specified property (attr) (or function) of all the nodes
 *  parent nodes.
 */
export function prepareSearchNodes(nodes = [],
                                   attr = "name",
                                   parent = "parentId") {

    const nodesById = _.keyBy(nodes, "id");

    const attrFn = _.isString(attr)
        ? n => n[attr]
        : attr;


    const parentFn = _.isString(parent)
        ? n => n[parent]
        : parent;


    return _.map(nodes, n => {
        let ptr = n;
        let searchStr = "";
        const nodePath = [];
        while (ptr) {
            nodePath.push(ptr);
            searchStr += (attrFn(ptr) || "") + " ";
            const parentId = parentFn(ptr);
            ptr = nodesById[parentId];
        }
        return {
            searchStr: searchStr.toLowerCase(),
            node: n,
            nodePath
        };
    });
}


/**
 * The given `termStr` will be tokenised and
 * all nodes (given in `searchNodes`) which contain all tokens
 * will be returned (de-duped).
 *
 * Use `prepareSearchNodes` to prepare the search nodes.
 * @param termStr
 * @param searchNodes
 */
export function doSearch(termStr = "", searchNodes = []) {
    const terms = _.split(termStr.toLowerCase(), /\W+/);

    return _
        .chain(searchNodes)
        .filter(sn => {
            const noTerms = termStr.trim().length === 0;
            const allMatch = _.every(terms, t => sn.searchStr.indexOf(t) >=0);
            return noTerms || allMatch;
        })
        .flatMap("nodePath")
        .uniqBy(n => n.id)
        .value();
}


/**
 * Given data that looks like:
 *
 *    [ { id: "",  parentId: ?, ... } , .. ]
 *
 * Gives back an array of top level objects which have children
 * nested in them, the result looks something like:
 *
 *    [ id: "", parentId : ?, parent : {}?, children : [ .. ], ... },  .. ]
 *
 * @param nodes
 * @param parentsAsRefs - whether to include parent as references or simple ids
 * @returns {Array}
 */
export function populateParents(nodes, parentsAsRefs = true) {
    const byId = _
        .chain(_.cloneDeep(nodes))
        .map(u => _.merge(u, { children: [], parent: null }))
        .keyBy("id")
        .value();

    _.each(_.values(byId), u => {
        if (u.parentId) {
            const parent = byId[u.parentId];
            if (parent) {
                parent.children.push(u);
                u.parent = parentsAsRefs
                    ? parent
                    : parent.id;
            }
        }
    });

    return _.values(byId);
}


/**
 *
 * @param nodes - flat list of nodes with `id` and `parentId` attributes
 * @param parentsAsRefs - `true` if parent should be an object, false if parent should be the identifier
 * @returns {unknown[]}
 */
export function buildHierarchies(nodes, parentsAsRefs = true) {
    // only give back root element/s
    return _.reject(populateParents(nodes, parentsAsRefs), n => n.parent);
}

export const reduceToSelectedNodesOnly = (nodes, selectedNodeIds = []) => {
    const byId = _.keyBy(nodes, d => d.id);
    const selectedNodesOnly = _
        .chain(selectedNodeIds)
        .map(nId => byId[nId])
        .compact()
        .value();

    const selectedWithParents = _
        .chain(selectedNodesOnly)
        .flatMap(n => _.concat([n], getParents(n, d => byId[d.parentId])))
        .uniq()
        .value();

    return selectedWithParents;

}

/**
 * Given a forest like structure (typically generated by buildHierarchies)
 * returns a flattened map object representing the hierarchical structure,
 * the map is indexed by the value returned by the keyFn.
 *
 * The second argument is a function which returns the key value for a given node
 *
 * End users should call this function without passing a third argument
 * as it is simply the accumulator used when recursing down the branches of the
 * trees.
 */
export function indexHierarchyByKey(tree = [], keyFn = n => n.id, acc = {}) {
    _.forEach(tree, node => {
        acc[keyFn(node)] = node;
        indexHierarchyByKey(node.children, keyFn, acc);
    });
    return acc;
}


export function groupHierarchyByKey(tree = [], keyFn = n => n.id, acc = {}) {
    _.forEach(tree, node => {
        const key = keyFn(node);
        const bucket = acc[key] || [];
        bucket.push(node)
        acc[key] = bucket;
        groupHierarchyByKey(node.children, keyFn, acc);
    });
    return acc;
}


export function flattenChildren(node, acc = []) {
    _.forEach(node.children || [], child => {
        acc.push(child);
        flattenChildren(child, acc);
    });
    return acc;
}


/**
 The wix tree widget does deep comparisons.
 Having parents as refs therefore blows the callstack.
 This method will replace refs with id's.
 */
export function switchToParentIds(treeData = []) {
    _.each(treeData, td => {
        td.parent = td.parent ? td.parent.id : null;
        switchToParentIds(td.children);
    });
    return treeData;
}


export function findNode(nodes = [], id) {
    const found = _.find(nodes, { id });
    if (found) return found;

    for(let i = 0; i < nodes.length; i++) {
        const f = findNode(nodes[i].children, id);
        if (f) return f;
    }

    return null;
}


/**
 *
 * @param node
 * @param getParentFn - function to resolve parent, defaults to `n => n.parent`
 * @returns {Array}
 */

export function getParents(node, getParentFn = (n) => n.parent) {
    if (! node) return [];

    let ptr = getParentFn(node);

    const result = [];

    while (ptr) {
        result.push(ptr);
        ptr = getParentFn(ptr);
    }

    return result;
}


/**
 * A naive approach to limiting the depth/number of nodes to draw in a tree.
 * If the number of nodes is too high performance suffers.  Limiting the
 * expanded tree depth helps keep the rendered node count down.
 *
 * The values were determined by simple experimentation.
 *
 * @param numNodes
 * @returns {number}
 */
export function determineDepthLimit(numNodes) {
    if (numNodes > 1000) return 1;
    if (numNodes > 600) return 2;
    if (numNodes > 200) return 3;
    return 100;
}


/**
 * Takes a hierarchy and a max depth and returns the set of nodes needed
 * to fully expand the tree.
 *
 * - leaf nodes are not included as they do not need to be expanded
 * - we optionally limit the depth of the tree to (hopefully) prevent large numbers of nodes
 *
 * @param hierarchy
 * @param maxDepth
 * @returns {*}
 */
export function determineExpandedNodes(hierarchy, maxDepth = 100) {
    const shouldHalt = (n, currDepth) =>
        _.isEmpty(n.children) // we don't care about leaf nodes, they don't need expanding
        || currDepth > (maxDepth - 1); // we knock 1 off as we are expanding this node, effectively giving us depth + 1

    const walk = (n, currDepth = 0) => shouldHalt(n, currDepth)
        ? []
        : _
            .chain(n.children)
            .map(c => walk(c, currDepth + 1)) // recurse
            .flatten()
            .concat([n])
            .value();

    return _
        .chain(hierarchy)   // do the walk for each tree in the forest
        .map(n => walk(n, 0))
        .concat()
        .flatten()
        .value();
}


/**
 * Given a list of flat nodes and a starting node id will return a 'sliver' of the
 * tree with all parents and children of the starting node populated.  All other
 * nodes are omitted.
 *
 * @param flatNodes  starting list of nodes
 * @param nodeId  starting node id
 * @param idFn  optional accessor for getting the node id (defaults to n=>n.id)
 * @param parentIdFn  optional accessor for getting the parent node id (defaults to n=>n.parentId)
 * @returns {*}  node at the top of the sliver, each node may have parent and children attributes populated
 */
export function directLineage(flatNodes,
                              nodeId,
                              idFn = n => n.id,
                              parentIdFn = n => n.parentId) {
    const byId = _.keyBy(flatNodes, idFn);
    const byParentId = _.groupBy(flatNodes, parentIdFn);

    const start = byId[nodeId];

    // parents
    let parent = byId[parentIdFn(start)];
    let ptr = start;
    while(parent != null) {
        ptr.parent = parent;
        parent.children = [ptr];
        ptr = parent;
        parent = byId[parentIdFn(parent)];
    }

    // recursively populate children
    const recurse = (node) => {
        const kids = byParentId[idFn(node)];
        if (kids) {
            node.children = kids;
            _.each(kids, recurse);
        }
    }
    recurse(start);

    // find head
    let head = start;
    while (head.parent != null) {
        head = head.parent;
    }
    return head;
}