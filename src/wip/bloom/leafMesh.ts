import Delaunator from "delaunator";
import * as THREE from "three";

export class LeafNode extends THREE.Bone {
    // position - position relative to parent.
    // leaves grow in the +x direction - that is the primary vein direction.
    // root leaf node is at 0,0,0.
    // +-z are the secondary vein directions
    // +-y is the curl/waviness direction
    constructor(public depth: number, public sideDepth: number) {
        super(null as any);
    }

    private nodeChildren?: LeafNode[];
    public leftNode?: LeafNode;
    public forwardNode?: LeafNode;
    public rightNode?: LeafNode;

    public index!: number;

    public addChildren(
        mainAxisDist: number,
        secondaryAxisDist: number,
        secondaryAxisAngle: number,
        scale: number,
        secondaryScale: number,
        maxSideDepth: number,
        alwaysSecondary: boolean,
    ) {
        this.nodeChildren = [];

        let totalRotation = 0;
        for (let node: LeafNode = this; node instanceof LeafNode; node = node.parent as LeafNode) {
            totalRotation += node.rotation.y;
        }
        // don't add super curly children
        if (Math.abs(totalRotation) > Math.PI * 3 / 2) {
            return this.nodeChildren;
        }

        if (this.sideDepth > maxSideDepth) {
            return this.nodeChildren;
        }
        const sideScale = scale * secondaryScale;
        // maybe don't put a secondary vein going in towards the leaf
        //  >= 0;
        if (totalRotation >= 0 || alwaysSecondary) {
            const leftNode = this.leftNode = new LeafNode(this.depth + 1, this.sideDepth + 1);
            leftNode.position.x = secondaryAxisDist;
            leftNode.position.applyEuler(new THREE.Euler(0, secondaryAxisAngle, 0));
            leftNode.rotation.y = secondaryAxisAngle;
            leftNode.scale.set(sideScale, sideScale, sideScale);
            this.add(leftNode);
            this.nodeChildren.push(leftNode);
        }

        // extend the main axis
        const forwardNode = this.forwardNode = new LeafNode(this.depth + 1, this.sideDepth);
        forwardNode.position.x = mainAxisDist;
        forwardNode.scale.set(scale, scale, scale);
        this.add(forwardNode);
        this.nodeChildren.push(forwardNode);

        if (totalRotation <= 0 || alwaysSecondary) {
            const rightNode = this.rightNode = new LeafNode(this.depth + 1, this.sideDepth + 1);
            rightNode.position.x = secondaryAxisDist;
            rightNode.position.applyEuler(new THREE.Euler(0, -secondaryAxisAngle, 0));
            rightNode.rotation.y = -secondaryAxisAngle;
            rightNode.scale.set(sideScale, sideScale, sideScale);
            this.add(rightNode);
            this.nodeChildren.push(rightNode);
        }
        return this.nodeChildren;
    }
}

export class LeafMesh extends THREE.Object3D {
    public skeleton: THREE.Skeleton;
    public mesh: THREE.SkinnedMesh;

    // layer 0 is the root, layer 1 is [left, mid, right], layer 2 is same, sorted left to right
    // each layer is sorted left to right within that layer
    public depthLayers: LeafNode[][];
    public sideDepthLayers: LeafNode[][];

    // nodes who have no children
    public edgeLayer: LeafNode[];

    constructor() {
        super();
        const rootNode = new LeafNode(0, 0);
        // let mainAxisDist = 0.4;
        let mainAxisDist = THREE.Math.randFloat(0.5, 1);
        // let mainAxisDist = 0.3;
        const secondaryAxisDistBase = THREE.Math.randFloat(0.4, 0.8);
        // let secondaryAxisDist = 0.15;
        let secondaryAxisAngle = THREE.Math.randFloat(Math.PI / 12, Math.PI / 3);
        // const secondaryAxisAngle = Math.PI / 2;
        let scale = THREE.Math.randFloat(0.9, 1.0);
        const iterations = THREE.Math.randInt(2, 6);
        // const iterations = 6;
        const scaleMultiplier = THREE.Math.randFloat(0.9, 1);
        // const scaleMultiplier = 0.6;
        // const scaleMultiplier = 1;
        // const mainAxisDistMultiplier = 1;
        const sideScale = 0.8;
        const mainAxisDistMultiplier = Math.sqrt(THREE.Math.randFloat(0.8, 1));
        const angleScalar = THREE.Math.randFloat(0.8, 1 / 0.8);
        // const maxSideDepth = 1;
        const maxSideDepth = THREE.Math.randInt(0, 3);
        const alwaysSecondary = false; // Math.random() < 0.5 ? true : false;
        const secondaryAxisDistFns: Array<(x: number) => number> = [
            (x) => x * (1 - x),
            (x) => Math.pow(0.2, x),
            (x) => Math.pow(0.5, x),
            (x) => 1 / (1 + x),
        ];
        const fn = secondaryAxisDistFns[THREE.Math.randInt(0, secondaryAxisDistFns.length - 1)];

        const allLeafNodes = [rootNode];
        let boundary = [rootNode];
        this.edgeLayer = [rootNode];
        for (let i = 0; i < iterations; i++) {
            const x = i / iterations;
            const secondaryAxisDist = secondaryAxisDistBase * fn(x);
            const newBoundary: LeafNode[] = [];
            for (const leafNode of boundary) {
                const children = leafNode.addChildren(mainAxisDist, secondaryAxisDist, secondaryAxisAngle, scale, sideScale, maxSideDepth, alwaysSecondary);
                newBoundary.push(...children);
            }
            boundary = newBoundary;
            allLeafNodes.push(...newBoundary);
            this.edgeLayer = [...newBoundary];
            scale *= scaleMultiplier;
            mainAxisDist *= mainAxisDistMultiplier;
            secondaryAxisAngle *= angleScalar;
        }
        // root node should be an edge
        this.edgeLayer.push(rootNode);

        // compute depth and sideDepth
        this.depthLayers = [];
        this.sideDepthLayers = [];
        for (let i = 0; i < allLeafNodes.length; i++) {
            const leafNode = allLeafNodes[i];
            leafNode.index = i;
            const { depth, sideDepth } = leafNode;
            this.sideDepthLayers[sideDepth] = this.sideDepthLayers[sideDepth] || [];
            this.sideDepthLayers[sideDepth].push(leafNode);
            this.depthLayers[depth] = this.depthLayers[depth] || [];
            this.depthLayers[depth].push(leafNode);
        }

        this.skeleton = new THREE.Skeleton(allLeafNodes);
        this.mesh = this.createMesh(this.skeleton);
        this.add(this.mesh);
    }

    private createMesh(skeleton: THREE.Skeleton) {
        const geometry = new THREE.Geometry();
        for (let i = 0; i < skeleton.bones.length; i++) {
            const leafNode = skeleton.bones[i] as LeafNode;
            const vertex = leafNode.getWorldPosition();
            geometry.vertices.push(vertex);
            geometry.skinIndices.push(new THREE.Vector4(i, 0, 0, 0) as any);
            geometry.skinWeights.push(new THREE.Vector4(1, 0, 0, 0) as any);
        }
        geometry.verticesNeedUpdate = true;
        /* face algorithm
        for each node, create 4 faces:
        1. forward, left, me
        2. forward, me, right
        3. me, left, parent
        4. me, parent, right
         */
        const childFaces = () => {
            for (const leafNode of skeleton.bones as LeafNode[]) {
                const { index, parent, forwardNode, leftNode, rightNode } = leafNode;
                if (forwardNode != null) {
                    if (leftNode != null) {
                        geometry.faces.push(new THREE.Face3(forwardNode.index, leftNode.index, index));
                        if (parent instanceof LeafNode) {
                            geometry.faces.push(new THREE.Face3(index, leftNode.index, parent.index));
                        }
                    }
                    if (rightNode != null) {
                        geometry.faces.push(new THREE.Face3(forwardNode.index, index, rightNode.index));
                        if (parent instanceof LeafNode) {
                            geometry.faces.push(new THREE.Face3(index, parent.index, rightNode.index));
                        }
                    }
                }
            }
        };
        // face algorithm 2:
        // connect siblings in quads
        // for (const layer of this.sideDepthLayers) {
        const cousinFaces = () => {
            for (const layer of this.depthLayers) {
                for (let i = 0; i < layer.length; i++) {
                    const me = layer[i];
                    const { leftNode, forwardNode, rightNode } = me;
                    if (forwardNode != null) {
                        const { leftNode: leftCousin, rightNode: rightCousin } = forwardNode;
                        if (leftNode != null) {
                            geometry.faces.push(new THREE.Face3(me.index, forwardNode.index, leftNode.index));
                            if (leftCousin != null) {
                                geometry.faces.push(new THREE.Face3(leftCousin.index, leftNode.index, forwardNode.index));
                            }
                        }
                        if (rightNode != null) {
                            geometry.faces.push(new THREE.Face3(forwardNode.index, me.index, rightNode.index));
                            if (rightCousin != null) {
                                geometry.faces.push(new THREE.Face3(rightCousin.index, forwardNode.index, rightNode.index));
                            }
                        }
                    }
                }
            }
        };
        // algorithm 3:
        // delauney triangulate

        // return true to include/keep
        type Filter = (a: LeafNode, b: LeafNode, c: LeafNode) => boolean;
        const triangleFilters: { [name: string]: Filter } = {
            // filter out faces that are all in the edge layer
            // this produces fascinating edge patterns and a few holes
            // TODO doesn't capture the end bones
            noEdgeLayer: (a, b, c) => !(
                this.edgeLayer.indexOf(a) !== -1 &&
                this.edgeLayer.indexOf(b) !== -1 &&
                this.edgeLayer.indexOf(c) !== -1
            ),
            // filter out faces that are in the edge layer and all 3 don't share a parent.
            noEdgeLayerAndSiblings: (a, b, c) => {
                const aParent = a.parent;
                const bParent = b.parent;
                const cParent = c.parent;
                return !(
                    this.edgeLayer.indexOf(a) !== -1 &&
                    this.edgeLayer.indexOf(b) !== -1 &&
                    this.edgeLayer.indexOf(c) !== -1 &&
                    aParent !== bParent &&
                    bParent !== cParent &&
                    aParent !== cParent
                );
            },
            // filter out very thin faces, usually those are indicative of outer edge craziness
            noThinTriangles: (a, b, c) => {
                const aWorld = a.getWorldPosition();
                const bWorld = b.getWorldPosition();
                const cWorld = c.getWorldPosition();
                const aAngle = bWorld.clone().sub(aWorld).angleTo(cWorld.clone().sub(aWorld));
                const bAngle = aWorld.clone().sub(bWorld).angleTo(cWorld.clone().sub(bWorld));
                const cAngle = bWorld.clone().sub(cWorld).angleTo(aWorld.clone().sub(cWorld));
                const epsilonAngle = Math.PI / 180 * 2;
                return triangleFilters.noEdgeLayer(a, b, c) && (
                    aAngle > epsilonAngle &&
                    bAngle > epsilonAngle &&
                    cAngle > epsilonAngle
                );
            },
        };

        const delauneyFaces = (...filters: Filter[]) => {
            const allLeafNodes = skeleton.bones as LeafNode[];
            try {
                const delaunator = Delaunator.from(allLeafNodes,
                    (bone) => bone.getWorldPosition().x,
                    (bone) => bone.getWorldPosition().z,
                );
                for (let i = 0; i < delaunator.triangles.length; i += 3) {
                    const indexA = delaunator.triangles[i];
                    const indexB = delaunator.triangles[i + 1];
                    const indexC = delaunator.triangles[i + 2];
                    const a = skeleton.bones[indexA] as LeafNode;
                    const b = skeleton.bones[indexB] as LeafNode;
                    const c = skeleton.bones[indexC] as LeafNode;
                    const passesFilter = filters.every((filter) => filter(a, b, c));
                    if (passesFilter) {
                        const face = new THREE.Face3(indexA, indexB, indexC);
                        geometry.faces.push(face);
                    }
                }
            } catch (e) {
                console.error(e);
                // do nothing
            }
        };

        // delauneyExceptLastDepthFaces();
        /* one of two modes
         * cousin + child builds fan-shaped or compound leaves
         * delauney builds simple Entire edges
        */
        const mode = (Math.random() < 0.33) ? "compound" : Math.random() < 0.5 ? "entire" : "complexEdge";
        // const mode = "entire";
        if (mode === "compound") {
            childFaces();
            cousinFaces();
        } else if (mode === "entire") {
            // delauneyExceptLastDepthFaces();
            // cousinFaces();
            // childFaces();
            delauneyFaces();
        } else if (mode === "complexEdge") {
            delauneyFaces(triangleFilters.noEdgeLayerAndSiblings, triangleFilters.noThinTriangles);
        }

        // geometry.normalize();
        // geometry.scale(0.5, 0.5, 0.5);
        // geometry.rotateX(Math.PI);
        // geometry.translate(0.5, 0, 0);
        geometry.computeFaceNormals();
        geometry.computeFlatVertexNormals();
        geometry.computeVertexNormals();

        geometry.computeBoundingBox();
        const boundingBox = geometry.boundingBox;
        const xScale = 1 / (boundingBox.max.x - boundingBox.min.x);
        const mat = new THREE.MeshLambertMaterial({skinning: true, color: "green", side: THREE.DoubleSide });
        const mesh = new THREE.SkinnedMesh(geometry, mat);
        mesh.add(skeleton.bones[0]);
        mesh.bind(skeleton);
        // const mesh2 = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({color: "darkgreen", transparent: true, opacity: 0.2, wireframe: true, side: THREE.DoubleSide}));
        // mesh.add(mesh2);
        // mesh2.bind(skeleton);

        // mesh.scale is used to normalize the leaf x length
        mesh.scale.set(xScale, xScale, xScale);
        // hackhack - our faces are on the wrong side i think and shadows aren't showing through
        mesh.rotation.x = Math.PI;
        mesh.receiveShadow = true;
        mesh.castShadow = true;

        return mesh;
    }
}