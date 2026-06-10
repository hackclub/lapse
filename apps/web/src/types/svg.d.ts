declare module "*.svg" {
    import * as React from "react";
    
    interface SVGProps extends React.SVGProps<SVGSVGElement> {
        title?: string;
    }
    
    const ReactComponent: React.FunctionComponent<SVGProps>;
    export default ReactComponent;
}
