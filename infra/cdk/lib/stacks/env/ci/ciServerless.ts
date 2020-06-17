import {Construct, Stack} from "@aws-cdk/core";
import {BuildSpec, Cache, LocalCacheMode, Project} from "@aws-cdk/aws-codebuild";
import {CodeBuildAction, CodeBuildActionProps} from "@aws-cdk/aws-codepipeline-actions";
import {Artifact, IStage} from "@aws-cdk/aws-codepipeline";
import {Effect, PolicyStatement} from "@aws-cdk/aws-iam";

import {EnvConstructProps} from "../../../types";
import {ServiceCiConfig} from "../../../patterns/serviceCiConfig";

interface ServerlessCiConfigProps extends EnvConstructProps {
    name: string;
    inputArtifact: Artifact;
    buildStage: IStage;
    deployStage: IStage;
}

export class ServerlessCiConfig extends ServiceCiConfig {
    constructor(scope: Construct, id: string, props: ServerlessCiConfigProps) {
        super(scope, id, {envSettings: props.envSettings});

        const buildArtifact = Artifact.artifact(`${props.envSettings.projectEnvName}-${props.name}`);

        const buildProject = this.createBuildProject(props);
        props.buildStage.addAction(this.createBuildAction({
            project: buildProject,
            input: props.inputArtifact,
            outputs: [buildArtifact],
        }, props));

        const deployProject = this.createDeployProject(props);
        props.deployStage.addAction(this.createDeployAction({
            project: deployProject,
            input: buildArtifact,
        }, props));
    }

    private createBuildAction(actionProps: Partial<CodeBuildActionProps>, props: ServerlessCiConfigProps) {
        return new CodeBuildAction(<CodeBuildActionProps>{
            ...actionProps,
            actionName: `${props.envSettings.projectName}-build-${props.name}`,
        });
    }

    private createBuildProject(props: ServerlessCiConfigProps) {
        return new Project(this, "BuildProject", {
            projectName: `${props.envSettings.projectName}-build-${props.name}`,
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {commands: ['make install-serverless']},
                    build: {commands: [`make build-${props.name}`]},
                },
                artifacts: {
                    files: [
                        '*',
                        'infra/**/*',
                        'scripts/**/*',
                        `services/${props.name}/**/*`,
                    ],
                },
            }),
            environment: {
                privileged: true,
            },
            environmentVariables: {...this.defaultEnvVariables},
            cache: Cache.local(LocalCacheMode.CUSTOM),
        });
    }

    private createDeployAction(actionProps: Partial<CodeBuildActionProps>, props: ServerlessCiConfigProps) {
        return new CodeBuildAction(<CodeBuildActionProps>{
            ...actionProps,
            actionName: `${props.envSettings.projectName}-deploy-${props.name}`,
        });
    }

    private createDeployProject(props: ServerlessCiConfigProps) {
        const stack = Stack.of(this);
        const project = new Project(this, "DeployProject", {
            projectName: `${props.envSettings.projectName}-deploy-${props.name}`,
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {commands: ['make install-serverless', `make -C services/${props.name} install`]},
                    build: {commands: [`make deploy-${props.name}`]},
                },
                cache: {
                    paths: [
                        'infra/cdk/node_modules/**/*',
                        `services/${props.name}/node_modules/**/*`,
                    ],
                },
            }),
            environment: {
                privileged: true,
            },
            environmentVariables: {...this.defaultEnvVariables},
            cache: Cache.local(LocalCacheMode.CUSTOM, LocalCacheMode.DOCKER_LAYER),
        });

        project.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'cloudformation:*',
            ],
            resources: [
                `arn:aws:cloudformation:${stack.region}:${stack.account}:stack/CDKToolkit/*`,
                `arn:aws:cloudformation:${stack.region}:${stack.account}:stack/${props.envSettings.projectName}-${props.name}-${props.envSettings.envStage}/*`,
            ],
        }));

        project.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'iam:*',
                'cloudfront:*',
                's3:*',
                'lambda:*',
                'apigateway:*',
                'cloudformation:ValidateTemplate',
            ],
            resources: ['*'],
        }));

        return project;
    }
}